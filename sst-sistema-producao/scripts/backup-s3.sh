#!/bin/bash

# Sistema de Backup Automático para S3
# Backup completo do Sistema SST

set -e

# Configurações
BACKUP_NAME="sst-backup-$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/tmp/$BACKUP_NAME"
S3_BUCKET="sst-backups-prod"
S3_PREFIX="backups/$(date +%Y)/$(date +%m)"
RETENTION_DAYS=30
ENCRYPT_KEY_ID="alias/sst-backup-key"

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Logging
log_info() {
    echo -e "${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Verificar dependências
check_dependencies() {
    log_info "Verificando dependências..."
    
    local deps=("aws" "pg_dump" "mysqldump" "tar" "gpg" "openssl")
    
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log_error "Dependência $dep não encontrada"
            exit 1
        fi
    done
    
    log_info "Todas dependências verificadas"
}

# Criar estrutura de backup
create_backup_structure() {
    log_info "Criando estrutura de backup..."
    
    mkdir -p "$BACKUP_DIR"/{database,uploads,config,logs,secrets}
    
    # Metadados do backup
    cat > "$BACKUP_DIR/metadata.json" << EOF
{
  "backup_name": "$BACKUP_NAME",
  "backup_date": "$(date -Iseconds)",
  "system_version": "$(cat /app/package.json | jq -r '.version')",
  "database_type": "postgresql",
  "retention_days": $RETENTION_DAYS,
  "checksum_algorithm": "SHA256"
}
EOF
}

# Backup do banco de dados PostgreSQL
backup_postgres() {
    log_info "Iniciando backup do PostgreSQL..."
    
    local db_host="${DB_HOST:-localhost}"
    local db_port="${DB_PORT:-5432}"
    local db_name="${DB_DATABASE:-sst_database}"
    
    # Backup completo
    PGPASSWORD="$DB_PASSWORD" pg_dump \
        -h "$db_host" \
        -p "$db_port" \
        -U "$DB_USERNAME" \
        -d "$db_name" \
        --format=custom \
        --blobs \
        --verbose \
        --file="$BACKUP_DIR/database/full.backup"
    
    # Backup apenas schema para recovery rápido
    PGPASSWORD="$DB_PASSWORD" pg_dump \
        -h "$db_host" \
        -p "$db_port" \
        -U "$DB_USERNAME" \
        -d "$db_name" \
        --schema-only \
        --file="$BACKUP_DIR/database/schema.sql"
    
    # Backup de dados específicos (excluindo logs grandes)
    PGPASSWORD="$DB_PASSWORD" pg_dump \
        -h "$db_host" \
        -p "$db_port" \
        -U "$DB_USERNAME" \
        -d "$db_name" \
        --data-only \
        --exclude-table-data="audit_logs" \
        --exclude-table-data="system_logs" \
        --file="$BACKUP_DIR/database/data.sql"
    
    # Listar tables e sizes
    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$db_host" \
        -p "$db_port" \
        -U "$DB_USERNAME" \
        -d "$db_name" \
        -c "\dt+" > "$BACKUP_DIR/database/tables.txt"
    
    log_info "Backup PostgreSQL concluído"
}

# Backup do Redis
backup_redis() {
    log_info "Iniciando backup do Redis..."
    
    local redis_host="${REDIS_HOST:-localhost}"
    local redis_port="${REDIS_PORT:-6379}"
    
    # Salvar snapshot RDB
    redis-cli -h "$redis_host" -p "$redis_port" SAVE
    
    # Copiar dump.rdb se existir
    if [ -f "/var/lib/redis/dump.rdb" ]; then
        cp "/var/lib/redis/dump.rdb" "$BACKUP_DIR/database/redis.rdb"
    fi
    
    # Backup de configurações
    redis-cli -h "$redis_host" -p "$redis_port" CONFIG GET "*" > "$BACKUP_DIR/database/redis_config.txt"
    
    # Listar keys
    redis-cli -h "$redis_host" -p "$redis_port" --scan --pattern "*" > "$BACKUP_DIR/database/redis_keys.txt"
    
    log_info "Backup Redis concluído"
}

# Backup de uploads e arquivos
backup_uploads() {
    log_info "Iniciando backup de uploads..."
    
    local upload_dirs=(
        "/app/uploads"
        "/app/backups"
        "/app/logs"
        "/app/config"
    )
    
    for dir in "${upload_dirs[@]}"; do
        if [ -d "$dir" ]; then
            local dir_name=$(basename "$dir")
            log_info "Backup de $dir..."
            
            tar -czf "$BACKUP_DIR/uploads/$dir_name.tar.gz" \
                -C "$(dirname "$dir")" \
                "$(basename "$dir")"
        fi
    done
    
    # Backup de certificados SSL
    if [ -d "/etc/letsencrypt" ]; then
        log_info "Backup de certificados SSL..."
        tar -czf "$BACKUP_DIR/config/letsencrypt.tar.gz" \
            -C "/etc" "letsencrypt"
    fi
    
    log_info "Backup de uploads concluído"
}

# Backup de configurações
backup_config() {
    log_info "Iniciando backup de configurações..."
    
    # Configurações da aplicação
    cp -r /app/.env* "$BACKUP_DIR/config/" 2>/dev/null || true
    cp -r /app/config/* "$BACKUP_DIR/config/" 2>/dev/null || true
    
    # Configurações do sistema
    cp /etc/nginx/nginx.conf "$BACKUP_DIR/config/nginx.conf" 2>/dev/null || true
    cp -r /etc/nginx/sites-available "$BACKUP_DIR/config/" 2>/dev/null || true
    
    # Docker/container configs
    docker inspect $(docker ps -q) > "$BACKUP_DIR/config/containers.json" 2>/dev/null || true
    
    # Kubernetes configs (se aplicável)
    kubectl get all -o yaml > "$BACKUP_DIR/config/kubernetes-state.yaml" 2>/dev/null || true
    
    log_info "Backup de configurações concluído"
}

# Backup de secrets (criptografado)
backup_secrets() {
    log_info "Iniciando backup de secrets (criptografado)..."
    
    # Coletar secrets
    secrets=(
        "$DB_PASSWORD"
        "$JWT_SECRET"
        "$AWS_ACCESS_KEY_ID"
        "$AWS_SECRET_ACCESS_KEY"
    )
    
    # Criar arquivo de secrets temporário
    cat > "$BACKUP_DIR/secrets/secrets.txt" << EOF
DB_PASSWORD=$DB_PASSWORD
JWT_SECRET=$JWT_SECRET
AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
MICROSOFT_CLIENT_SECRET=$MICROSOFT_CLIENT_SECRET
EOF
    
    # Criptografar com GPG
    gpg --batch --yes \
        --recipient "backup@sst.com" \
        --encrypt \
        --output "$BACKUP_DIR/secrets/secrets.gpg" \
        "$BACKUP_DIR/secrets/secrets.txt"
    
    # Remover arquivo não criptografado
    rm -f "$BACKUP_DIR/secrets/secrets.txt"
    
    # Criptografar com AWS KMS também
    aws kms encrypt \
        --key-id "$ENCRYPT_KEY_ID" \
        --plaintext fileb://<(echo "$DB_PASSWORD") \
        --output text \
        --query CiphertextBlob > "$BACKUP_DIR/secrets/db_password.kms"
    
    log_info "Backup de secrets concluído (criptografado)"
}

# Validar backup
validate_backup() {
    log_info "Validando integridade do backup..."
    
    # Verificar arquivos essenciais
    essential_files=(
        "$BACKUP_DIR/database/full.backup"
        "$BACKUP_DIR/metadata.json"
    )
    
    for file in "${essential_files[@]}"; do
        if [ ! -f "$file" ]; then
            log_error "Arquivo essencial não encontrado: $file"
            return 1
        fi
    done
    
    # Verificar tamanho mínimo
    local total_size=$(du -sb "$BACKUP_DIR" | cut -f1)
    if [ "$total_size" -lt 1000000 ]; then  # 1MB mínimo
        log_error "Backup muito pequeno: $total_size bytes"
        return 1
    fi
    
    # Calcular checksums
    log_info "Calculando checksums..."
    find "$BACKUP_DIR" -type f -name "*.backup" -o -name "*.sql" -o -name "*.tar.gz" | \
        while read -r file; do
            sha256sum "$file" >> "$BACKUP_DIR/checksums.sha256"
        done
    
    log_info "Validação do backup concluída com sucesso"
    return 0
}

# Compactar backup
compress_backup() {
    log_info "Compactando backup..."
    
    local backup_archive="/tmp/$BACKUP_NAME.tar.gz"
    
    tar -czf "$backup_archive" \
        -C "/tmp" \
        "$BACKUP_NAME"
    
    # Calcular checksum do arquivo compactado
    sha256sum "$backup_archive" > "$backup_archive.sha256"
    
    echo "$backup_archive"
}

# Upload para S3
upload_to_s3() {
    local backup_archive=$1
    
    log_info "Enviando backup para S3..."
    
    local s3_key="$S3_PREFIX/$BACKUP_NAME.tar.gz"
    
    # Upload com multipart para arquivos grandes
    aws s3 cp "$backup_archive" "s3://$S3_BUCKET/$s3_key" \
        --storage-class STANDARD_IA \
        --metadata "BackupDate=$(date -Iseconds),RetentionDays=$RETENTION_DAYS" \
        --tagging "Environment=Production,BackupType=Full,Retention=$RETENTION_DAYS"
    
    # Upload do checksum
    aws s3 cp "$backup_archive.sha256" "s3://$S3_BUCKET/$S3_PREFIX/$BACKUP_NAME.tar.gz.sha256"
    
    # Upload do relatório
    aws s3 cp "$BACKUP_DIR/metadata.json" "s3://$S3_BUCKET/$S3_PREFIX/$BACKUP_NAME.metadata.json"
    
    log_info "Backup enviado para S3: s3://$S3_BUCKET/$s3_key"
    
    echo "$s3_key"
}

# Rotação de backups antigos
rotate_old_backups() {
    log_info "Executando rotação de backups antigos..."
    
    # Listar backups antigos
    local cutoff_date=$(date -d "$RETENTION_DAYS days ago" +%Y-%m-%d)
    
    aws s3 ls "s3://$S3_BUCKET/backups/" --recursive | \
        while read -r line; do
            local date=$(echo "$line" | awk '{print $1}')
            local key=$(echo "$line" | awk '{print $4}')
            
            if [[ "$date" < "$cutoff_date" ]]; then
                log_info "Removendo backup antigo: $key"
                aws s3 rm "s3://$S3_BUCKET/$key"
            fi
        done
    
    # Aplicar lifecycle policy
    log_info "Aplicando política de lifecycle..."
    aws s3api put-bucket-lifecycle-configuration \
        --bucket "$S3_BUCKET" \
        --lifecycle-configuration '{
            "Rules": [
                {
                    "ID": "BackupTransition",
                    "Status": "Enabled",
                    "Prefix": "backups/",
                    "Transitions": [
                        {
                            "Days": 30,
                            "StorageClass": "GLACIER"
                        },
                        {
                            "Days": 90,
                            "StorageClass": "DEEP_ARCHIVE"
                        }
                    ],
                    "Expiration": {
                        "Days": 365
                    }
                }
            ]
        }'
    
    log_info "Rotação de backups concluída"
}

# Testar restore
test_restore() {
    log_info "Testando restauração do backup..."
    
    # Criar ambiente de teste
    local test_dir="/tmp/restore-test-$BACKUP_NAME"
    mkdir -p "$test_dir"
    
    # Extrair backup
    tar -xzf "/tmp/$BACKUP_NAME.tar.gz" -C "$test_dir"
    
    # Verificar arquivos extraídos
    if [ -f "$test_dir/$BACKUP_NAME/database/full.backup" ]; then
        log_info "✓ Backup pode ser extraído com sucesso"
        
        # Testar restore do PostgreSQL em container temporário
        if command -v docker &> /dev/null; then
            log_info "Testando restore do PostgreSQL..."
            
            docker run --rm -d \
                --name test-postgres \
                -e POSTGRES_PASSWORD=test \
                postgres:15-alpine
            
            sleep 10  # Aguardar inicialização
            
            # Tentar restore
            docker exec test-postgres pg_restore \
                --username postgres \
                --dbname postgres \
                --verbose \
                --clean \
                --if-exists \
                < "$test_dir/$BACKUP_NAME/database/full.backup" && \
                log_info "✓ Restore PostgreSQL testado com sucesso"
            
            docker stop test-postgres
        fi
    else
        log_warn "Não foi possível testar restore completo"
    fi
    
    # Limpar
    rm -rf "$test_dir"
}

# Notificar status
send_notification() {
    local status=$1
    local s3_key=$2
    local backup_size=$3
    
    local subject=""
    local message=""
    
    if [ "$status" = "success" ]; then
        subject="✅ Backup SST Concluído com Sucesso"
        message="Backup $BACKUP_NAME concluído com sucesso\nTamanho: $backup_size\nLocal: s3://$S3_BUCKET/$s3_key"
    else
        subject="❌ Falha no Backup SST"
        message="Falha no backup $BACKUP_NAME\nErro: $status"
    fi
    
    # Enviar para Slack
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"$subject\n$message\"}" \
        "$SLACK_WEBHOOK_URL"
    
    # Enviar email
    echo -e "$message" | mail -s "$subject" "$ADMIN_EMAIL"
    
    # Registrar no CloudWatch
    aws cloudwatch put-metric-data \
        --namespace "SST/Backup" \
        --metric-name "BackupStatus" \
        --value "$([ "$status" = "success" ] && echo 1 || echo 0)" \
        --unit "Count"
    
    aws cloudwatch put-metric-data \
        --namespace "SST/Backup" \
        --metric-name "BackupSize" \
        --value "$backup_size" \
        --unit "Bytes"
}

# Função principal
main() {
    log_info "🚀 INICIANDO BACKUP SISTEMA SST 🚀"
    
    local start_time=$(date +%s)
    
    # Verificar variáveis de ambiente
    if [ -z "$DB_PASSWORD" ] || [ -z "$AWS_ACCESS_KEY_ID" ]; then
        log_error "Variáveis de ambiente não configuradas"
        exit 1
    fi
    
    # Executar passos do backup
    check_dependencies
    create_backup_structure
    backup_postgres
    backup_redis
    backup_uploads
    backup_config
    backup_secrets
    
    if ! validate_backup; then
        log_error "Validação do backup falhou"
        send_notification "validation_failed" "" "0"
        exit 1
    fi
    
    local backup_archive=$(compress_backup)
    local backup_size=$(stat -c%s "$backup_archive")
    local s3_key=$(upload_to_s3 "$backup_archive")
    
    test_restore
    rotate_old_backups
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Relatório final
    log_info "========================================="
    log_info "BACKUP CONCLUÍDO COM SUCESSO!"
    log_info "Nome: $BACKUP_NAME"
    log_info "Duração: $duration segundos"
    log_info "Tamanho: $(numfmt --to=iec $backup_size)"
    log_info "Local S3: s3://$S3_BUCKET/$s3_key"
    log_info "Retenção: $RETENTION_DAYS dias"
    log_info "========================================="
    
    # Notificar sucesso
    send_notification "success" "$s3_key" "$backup_size"
    
    # Limpar arquivos temporários
    rm -rf "$BACKUP_DIR" "/tmp/$BACKUP_NAME.tar.gz" "/tmp/$BACKUP_NAME.tar.gz.sha256"
    
    return 0
}

# Handler de erros
trap 'log_error "Backup interrompido"; send_notification "interrupted" "" "0"; exit 1' INT TERM

# Executar
main "$@"