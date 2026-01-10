#!/bin/sh

# Iniciar NGINX em background
nginx -g "daemon off;" &

# Aguardar NGINX iniciar
sleep 5

# Verificar se precisa obter certificado
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo "Obtendo certificado SSL inicial..."
    certbot certonly --nginx \
        -d $DOMAIN \
        -d www.$DOMAIN \
        --email $EMAIL \
        --agree-tos \
        --non-interactive \
        --force-renewal
fi

# Configurar renovação automática
echo "0 3 * * * certbot renew --quiet --post-hook 'nginx -s reload'" >> /etc/crontabs/root
crond -l 2 -b

# Manter container rodando
wait %1