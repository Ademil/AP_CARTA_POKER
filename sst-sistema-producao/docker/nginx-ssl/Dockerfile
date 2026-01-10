FROM nginx:alpine

# Instalar Certbot
RUN apk add --no-cache certbot certbot-nginx python3 py3-pip \
    && pip3 install certbot-dns-cloudflare \
    && mkdir -p /var/www/html /etc/letsencrypt

# Copiar configurações
COPY nginx.conf /etc/nginx/nginx.conf
COPY sites/ /etc/nginx/sites-enabled/
COPY ssl/ /etc/nginx/ssl/

# Copiar scripts
COPY scripts/ /scripts/
RUN chmod +x /scripts/*.sh

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD nginx -t && curl -f https://localhost/health || exit 1

# Expor portas
EXPOSE 80 443

# Entrypoint com renovação automática
ENTRYPOINT ["/scripts/entrypoint.sh"]