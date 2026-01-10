#!/bin/bash

# Script de deploy automatizado para Sistema SST

set -e  # Sai ao primeiro erro

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configurações
ENVIRONMENT=${1:-production}
VERSION=${2:-latest}
REGISTRY="registry.sst.com"
PROJECT="sst-system"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_dependencies() {
    log_info "Verificando dependências..."
    
    # Verificar Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker não encontrado"
        exit 1
    fi
    
    # Verificar Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose não encontrado"
        exit 1
    fi
    
    # Verificar Kubernetes
    if [ "$ENVIRONMENT" = "production" ]; then
        if ! command -v kubectl &> /dev/null; then
            log_error "kubectl não encontrado"
            exit 1
        fi
    fi
    
    log_info "Dependências verificadas com sucesso"
}

load_environment() {
    log_info "Carregando ambiente: $ENVIRONMENT"
    
    if [ ! -f ".env.$ENVIRONMENT" ]; then
        log_error "Arquivo .env.$ENVIRONMENT não encontrado"
        exit 1
    fi
    
    export $(cat .env.$ENVIRONMENT | xargs)
    log_info "Variáveis de ambiente carregadas"
}

build_images() {
    log_info "Construindo imagens Docker..."
    
    # Build backend
    log_info "Construindo backend..."
    docker build \
        -t $REGISTRY/$PROJECT-backend:$VERSION \
        -f backend/Dockerfile \
        --build-arg NODE_ENV=$ENVIRONMENT \
        backend/
    
    # Build frontend
    log_info "Construindo frontend..."
    docker build \
        -t $REGISTRY/$PROJECT-frontend:$VERSION \
        -f frontend/Dockerfile \
        --build-arg VITE_API_URL=$VITE_API_URL \
        frontend/
    
    # Push para registry
    log_info "Enviando imagens para registry..."
    docker push $REGISTRY/$PROJECT-backend:$VERSION
    docker push $REGISTRY/$PROJECT-frontend:$VERSION
    
    log_info "Imagens construídas e enviadas com sucesso"
}

run_migrations() {
    log_info "Executando migrações do banco de dados..."
    
    docker run --rm \
        --network sst-network \
        -e DB_HOST=$DB_HOST \
        -e DB_PORT=$DB_PORT \
        -e DB_USERNAME=$DB_USERNAME \
        -e DB_PASSWORD=$DB_PASSWORD \
        -e DB_DATABASE=$DB_DATABASE \
        $REGISTRY/$PROJECT-backend:$VERSION \
        npm run migrate
    
    log_info "Migrações executadas com sucesso"
}

deploy_kubernetes() {
    log_info "Deployando no Kubernetes..."
    
    # Atualizar secrets
    kubectl create secret generic sst-secrets \
        --from-literal=JWT_SECRET=$JWT_SECRET \
        --from-literal=DB_PASSWORD=$DB_PASSWORD \
        --dry-run=client -o yaml | kubectl apply -f -
    
    # Deploy PostgreSQL
    kubectl apply -f k8s/postgres.yaml
    kubectl rollout status statefulset/postgres
    
    # Deploy Redis
    kubectl apply -f k8s/redis.yaml
    kubectl rollout status deployment/redis
    
    # Deploy Backend
    kubectl apply -f k8s/backend.yaml
    kubectl rollout status deployment/backend
    
    # Deploy Frontend
    kubectl apply -f k8s/frontend.yaml
    kubectl rollout status deployment/frontend
    
    # Deploy Ingress
    kubectl apply -f k8s/ingress.yaml
    
    log_info "Deploy Kubernetes concluído"
}

deploy_docker_compose() {
    log_info "Deployando com Docker Compose..."
    
    docker-compose -f docker/docker-compose.yml pull
    docker-compose -f docker/docker-compose.yml up -d
    
    # Aguardar serviços
    sleep 10
    
    # Verificar status
    docker-compose -f docker/docker-compose.yml ps
    
    log_info "Deploy Docker Compose concluído"
}

run_tests() {
    log_info "Executando testes pós-deploy..."
    
    # Testar API
    API_URL="http://localhost:3000/health"
    response=$(curl -s -o /dev/null -w "%{http_code}" $API_URL)
    
    if [ "$response" -eq 200 ]; then
        log_info "API respondendo corretamente"
    else
        log_error "API não respondeu corretamente"
        exit 1
    fi
    
    # Testar frontend
    FRONTEND_URL="http://localhost:5173"
    response=$(curl -s -o /dev/null -w "%{http_code}" $FRONTEND_URL)
    
    if [ "$response" -eq 200 ]; then
        log_info "Frontend respondendo corretamente"
    else
        log_error "Frontend não respondeu corretamente"
        exit 1
    fi
    
    log_info "Testes concluídos com sucesso"
}

create_backup() {
    log_info "Criando backup pré-deploy..."
    
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_DIR="backups/$TIMESTAMP"
    
    mkdir -p $BACKUP_DIR
    
    # Backup do banco
    docker exec sst-postgres pg_dump -U $DB_USERNAME $DB_DATABASE > $BACKUP_DIR/database.sql
    
    # Backup de uploads
    tar -czf $BACKUP_DIR/uploads.tar.gz uploads/
    
    # Backup de logs
    tar -czf $BACKUP_DIR/logs.tar.gz logs/
    
    log_info "Backup criado em: $BACKUP_DIR"
}

send_notification() {
    log_info "Enviando notificações..."
    
    # Enviar para Slack
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"🚀 Deploy do Sistema SST $VERSION concluído em $ENVIRONMENT\"}" \
        $SLACK_WEBHOOK_URL
    
    # Enviar email
    echo "Deploy do Sistema SST $VERSION concluído em $ENVIRONMENT" | \
        mail -s "Deploy Sistema SST" $ADMIN_EMAIL
    
    log_info "Notificações enviadas"
}

# Fluxo principal
main() {
    log_info "Iniciando deploy do Sistema SST"
    log_info "Ambiente: $ENVIRONMENT"
    log_info "Versão: $VERSION"
    
    check_dependencies
    load_environment
    create_backup
    
    case $ENVIRONMENT in
        "development")
            build_images
            deploy_docker_compose
            ;;
        "staging")
            build_images
            deploy_docker_compose
            run_tests
            ;;
        "production")
            build_images
            run_migrations
            deploy_kubernetes
            run_tests
            send_notification
            ;;
        *)
            log_error "Ambiente inválido: $ENVIRONMENT"
            exit 1
            ;;
    esac
    
    log_info "Deploy concluído com sucesso!"
    log_info "URLs:"
    log_info "  - Frontend: http://localhost:5173"
    log_info "  - Backend API: http://localhost:3000"
    log_info "  - Backend Health: http://localhost:3000/health"
}

# Executar main
main "$@"