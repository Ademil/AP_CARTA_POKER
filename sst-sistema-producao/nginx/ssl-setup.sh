#!/bin/bash

# Script para configuração automática de SSL com Let's Encrypt

set -e

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

DOMAIN="sst.segurancadotrabalho.com"
EMAIL="admin@sst.com"
WEBROOT_PATH="/var/www/html"
SSL_PATH="/etc/nginx/ssl"
CERTS_PATH="/etc/letsencrypt/live/$DOMAIN"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

install_certbot() {
    log_info "Instalando Certbot..."
    
    apt-get update
    apt-get install -y certbot python3-certbot-nginx
    
    log_info "Certbot instalado com sucesso"
}

configure_nginx_ssl() {
    log_info "Configurando NGINX para SSL..."
    
    cat > /etc/nginx/sites-available/sst-ssl << EOF
# Configuração SSL - Sistema SST
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    
    server_name $DOMAIN www.$DOMAIN;
    
    # SSL Configuration
    ssl_certificate $CERTS_PATH/fullchain.pem;
    ssl_certificate_key $CERTS_PATH/privkey.pem;
    ssl_trusted_certificate $CERTS_PATH/chain.pem;
    
    # SSL Protocols
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    
    # SSL Ciphers
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_ecdh_curve secp384r1;
    
    # SSL Session
    ssl_session_timeout 10m;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    
    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';";
    
    # Root directory
    root $WEBROOT_PATH;
    
    # Frontend
    location / {
        try_files \$uri \$uri/ /index.html;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    
    # Backend API
    location /api/ {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Health checks
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
    
    # Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root $WEBROOT_PATH;
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    
    server_name $DOMAIN www.$DOMAIN;
    
    # Redirect to HTTPS
    return 301 https://\$server_name\$request_uri;
}
EOF
    
    ln -sf /etc/nginx/sites-available/sst-ssl /etc/nginx/sites-enabled/
    nginx -t
    systemctl reload nginx
    
    log_info "NGINX configurado para SSL"
}

obtain_certificate() {
    log_info "Obtendo certificado SSL da Let's Encrypt..."
    
    # Obter certificado
    certbot certonly --nginx \
        -d $DOMAIN \
        -d www.$DOMAIN \
        --email $EMAIL \
        --agree-tos \
        --non-interactive \
        --force-renewal
    
    log_info "Certificado obtido com sucesso"
}

setup_auto_renewal() {
    log_info "Configurando renovação automática..."
    
    # Criar script de renovação
    cat > /usr/local/bin/renew-ssl.sh << 'EOF'
#!/bin/bash

# Script de renovação de SSL
DOMAIN="sst.segurancadotrabalho.com"

echo "$(date): Iniciando renovação SSL para $DOMAIN"

# Tentar renovar
if certbot renew --quiet --post-hook "systemctl reload nginx"; then
    echo "$(date): SSL renovado com sucesso"
    
    # Notificar via Slack
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"✅ SSL renovado para $DOMAIN\"}" \
        $SLACK_WEBHOOK_URL
    
    # Atualizar Kubernetes secrets se aplicável
    kubectl create secret tls sst-tls \
        --cert /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
        --key /etc/letsencrypt/live/$DOMAIN/privkey.pem \
        --dry-run=client -o yaml | kubectl apply -f -
else
    echo "$(date): ERRO na renovação SSL"
    
    # Notificar erro
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"❌ FALHA na renovação SSL para $DOMAIN\"}" \
        $SLACK_WEBHOOK_URL
fi
EOF
    
    chmod +x /usr/local/bin/renew-ssl.sh
    
    # Adicionar ao crontab
    (crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/renew-ssl.sh >> /var/log/ssl-renewal.log 2>&1") | crontab -
    
    log_info "Renovação automática configurada (3 AM daily)"
}

setup_ssl_monitoring() {
    log_info "Configurando monitoramento de SSL..."
    
    # Script para verificar expiração
    cat > /usr/local/bin/check-ssl-expiry.sh << EOF
#!/bin/bash

DOMAIN="$DOMAIN"
DAYS_WARNING=30
DAYS_CRITICAL=7

CERT_FILE="$CERTS_PATH/fullchain.pem"

if [ ! -f "\$CERT_FILE" ]; then
    echo "CRITICAL: Certificado não encontrado"
    exit 2
fi

EXPIRY_DATE=\$(openssl x509 -in "\$CERT_FILE" -enddate -noout | cut -d= -f2)
EXPIRY_SECONDS=\$(date -d "\$EXPIRY_DATE" +%s)
CURRENT_SECONDS=\$(date +%s)
DAYS_LEFT=\$(( (EXPIRY_SECONDS - CURRENT_SECONDS) / 86400 ))

if [ \$DAYS_LEFT -lt \$DAYS_CRITICAL ]; then
    echo "CRITICAL: SSL expira em \$DAYS_LEFT dias"
    exit 2
elif [ \$DAYS_LEFT -lt \$DAYS_WARNING ]; then
    echo "WARNING: SSL expira em \$DAYS_LEFT dias"
    exit 1
else
    echo "OK: SSL válido por \$DAYS_LEFT dias"
    exit 0
fi
EOF
    
    chmod +x /usr/local/bin/check-ssl-expiry.sh
    
    # Configurar check no Prometheus
    cat > /etc/prometheus/ssl_exporter.yaml << EOF
ssl_certificate_expiry:
  targets:
    - host: $DOMAIN
      port: 443
  labels:
    service: "sst-system"
EOF
    
    log_info "Monitoramento de SSL configurado"
}

generate_dhparam() {
    log_info "Gerando parâmetros Diffie-Hellman..."
    
    if [ ! -f "$SSL_PATH/dhparam.pem" ]; then
        openssl dhparam -out "$SSL_PATH/dhparam.pem" 4096
        chmod 600 "$SSL_PATH/dhparam.pem"
        log_info "Parâmetros DH gerados"
    else
        log_info "Parâmetros DH já existem"
    fi
}

main() {
    log_info "Iniciando configuração de SSL para $DOMAIN"
    
    # Verificar se é root
    if [ "$EUID" -ne 0 ]; then 
        log_error "Execute como root"
        exit 1
    fi
    
    # Criar diretórios
    mkdir -p $WEBROOT_PATH $SSL_PATH
    
    # Instalar dependências
    install_certbot
    
    # Obter certificado
    obtain_certificate
    
    # Configurar NGINX
    configure_nginx_ssl
    
    # Gerar parâmetros DH
    generate_dhparam
    
    # Configurar renovação automática
    setup_auto_renewal
    
    # Configurar monitoramento
    setup_ssl_monitoring
    
    log_info "Configuração SSL concluída com sucesso!"
    log_info "Teste seu site: https://$DOMAIN"
    log_info "Verifique SSL: https://www.ssllabs.com/ssltest/analyze.html?d=$DOMAIN"
}

main "$@"