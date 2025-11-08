#!/bin/bash
# Nginx Setup Script for EC2
# Ensures nginx.conf has the required http block with conf.d include

set -e

NGINX_CONF="/etc/nginx/nginx.conf"

echo "🔧 Setting up Nginx configuration..."

# Check if http block exists
if ! grep -q "^http {" "$NGINX_CONF" 2>/dev/null; then
    echo "⚠️  http block missing in nginx.conf, adding it..."
    
    # Backup original config
    sudo cp "$NGINX_CONF" "${NGINX_CONF}.backup.$(date +%Y%m%d_%H%M%S)"
    
    # Append http block to nginx.conf
    sudo tee -a "$NGINX_CONF" > /dev/null << 'EOF'

http {
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    include /etc/nginx/conf.d/*.conf;
}
EOF
    
    echo "✅ Added http block to nginx.conf"
else
    echo "✅ http block already exists in nginx.conf"
fi

# Verify nginx config
echo "🔍 Testing nginx configuration..."
if sudo nginx -t; then
    echo "✅ Nginx configuration is valid"
    
    # Restart nginx if it's running
    if sudo systemctl is-active --quiet nginx; then
        echo "🔄 Restarting nginx..."
        sudo systemctl restart nginx
        echo "✅ Nginx restarted"
    else
        echo "ℹ️  Nginx is not running (start it with: sudo systemctl start nginx)"
    fi
else
    echo "❌ Nginx configuration test failed!"
    exit 1
fi

echo ""
echo "✅ Nginx setup complete!"
echo "📝 Configuration file: $NGINX_CONF"
echo "📁 Server configs: /etc/nginx/conf.d/"

