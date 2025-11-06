#!/bin/bash

# SmartProp Production Deployment Script
# Comprehensive deployment with health checks and rollback capability

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.local"
BACKUP_DIR="./backups"
LOG_FILE="./deployment.log"

# Functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✅ $1${NC}" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}❌ $1${NC}" | tee -a "$LOG_FILE"
}

# Pre-deployment checks
pre_deployment_checks() {
    log "Starting pre-deployment checks..."
    
    # Check if Docker is running
    if ! docker info > /dev/null 2>&1; then
        error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
    success "Docker is running"
    
    # Check if docker-compose file exists
    if [ ! -f "$COMPOSE_FILE" ]; then
        error "Docker compose file $COMPOSE_FILE not found"
        exit 1
    fi
    success "Docker compose file found"
    
    # Check if environment file exists
    if [ ! -f "$ENV_FILE" ]; then
        error "Environment file $ENV_FILE not found. Please copy .env.production to .env.local and configure it."
        exit 1
    fi
    success "Environment file found"
    
    # Check required environment variables
    source "$ENV_FILE"
    required_vars=("NEXT_PUBLIC_SUPABASE_URL" "SUPABASE_SERVICE_ROLE" "GROQ_API_KEY" "PUBLIC_BASE_URL")
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            error "Required environment variable $var is not set"
            exit 1
        fi
    done
    success "All required environment variables are set"
    
    # Check available disk space (minimum 5GB)
    available_space=$(df . | awk 'NR==2 {print $4}')
    if [ "$available_space" -lt 5242880 ]; then  # 5GB in KB
        warning "Low disk space. Available: $(($available_space / 1024 / 1024))GB"
    else
        success "Sufficient disk space available"
    fi
}

# Create backup
create_backup() {
    log "Creating backup..."
    
    mkdir -p "$BACKUP_DIR"
    backup_name="backup_$(date +%Y%m%d_%H%M%S)"
    
    # Backup volumes if they exist
    if docker volume ls | grep -q smartprop; then
        log "Backing up Docker volumes..."
        docker run --rm -v smartprop_app-storage:/source -v "$(pwd)/$BACKUP_DIR":/backup alpine tar czf "/backup/${backup_name}_app-storage.tar.gz" -C /source .
        docker run --rm -v smartprop_waha-sessions:/source -v "$(pwd)/$BACKUP_DIR":/backup alpine tar czf "/backup/${backup_name}_waha-sessions.tar.gz" -C /source .
        success "Docker volumes backed up"
    fi
    
    # Backup configuration files
    tar czf "$BACKUP_DIR/${backup_name}_config.tar.gz" "$ENV_FILE" nginx/ 2>/dev/null || true
    success "Configuration files backed up to $BACKUP_DIR/${backup_name}_config.tar.gz"
}

# Build and deploy
deploy() {
    log "Starting deployment..."
    
    # Pull latest images
    log "Pulling latest images..."
    docker-compose -f "$COMPOSE_FILE" pull smartprop-app
    
    # Start services
    log "Starting services..."
    docker-compose -f "$COMPOSE_FILE" up -d
    
    success "Services started"
}

# Health checks
health_checks() {
    log "Performing health checks..."
    
    # Wait for services to start
    sleep 30
    
    # Check if containers are running
    failed_services=()
    services=("smartprop-app" "smartprop-waha" "smartprop-nginx")
    
    for service in "${services[@]}"; do
        if ! docker ps | grep -q "$service"; then
            failed_services+=("$service")
        fi
    done
    
    if [ ${#failed_services[@]} -ne 0 ]; then
        error "Failed services: ${failed_services[*]}"
        return 1
    fi
    success "All containers are running"
    
    # Check application health endpoint
    max_attempts=10
    attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        log "Health check attempt $attempt/$max_attempts..."
        
        if curl -f -s http://localhost:3000/api/health > /dev/null; then
            success "Application health check passed"
            return 0
        fi
        
        sleep 10
        ((attempt++))
    done
    
    error "Application health check failed after $max_attempts attempts"
    return 1
}

# Rollback function
rollback() {
    error "Deployment failed. Starting rollback..."
    
    # Stop current deployment
    docker-compose -f "$COMPOSE_FILE" down
    
    # Restore from backup if available
    latest_backup=$(ls -t "$BACKUP_DIR"/*_config.tar.gz 2>/dev/null | head -1)
    if [ -n "$latest_backup" ]; then
        log "Restoring from backup: $latest_backup"
        tar xzf "$latest_backup"
    fi
    
    error "Rollback completed. Please check logs and fix issues before redeploying."
    exit 1
}

# Cleanup old backups (keep last 5)
cleanup_backups() {
    log "Cleaning up old backups..."
    
    if [ -d "$BACKUP_DIR" ]; then
        # Keep only the 5 most recent backups
        ls -t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
        success "Old backups cleaned up"
    fi
}

# Show deployment status
show_status() {
    log "Deployment Status:"
    echo ""
    echo "🐳 Docker Containers:"
    docker-compose -f "$COMPOSE_FILE" ps
    echo ""
    echo "📊 Resource Usage:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
    echo ""
    echo "🌐 Service URLs:"
    echo "  • Application: http://localhost:3000"
    echo "  • WAHA Dashboard: http://localhost:3030"
    echo ""
    echo "📋 Logs:"
    echo "  • View logs: docker-compose -f $COMPOSE_FILE logs -f"
    echo "  • App logs: docker-compose -f $COMPOSE_FILE logs -f smartprop-app"
    echo ""
}

# Main deployment flow
main() {
    log "🚀 Starting SmartProp Production Deployment"
    echo "=============================================="
    
    # Run pre-deployment checks
    pre_deployment_checks
    
    # Create backup
    create_backup
    
    # Deploy
    if deploy; then
        # Run health checks
        if health_checks; then
            success "🎉 Deployment completed successfully!"
            show_status
            cleanup_backups
        else
            rollback
        fi
    else
        rollback
    fi
}

# Handle script arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "status")
        show_status
        ;;
    "logs")
        docker-compose -f "$COMPOSE_FILE" logs -f "${2:-}"
        ;;
    "stop")
        log "Stopping services..."
        docker-compose -f "$COMPOSE_FILE" down
        success "Services stopped"
        ;;
    "restart")
        log "Restarting services..."
        docker-compose -f "$COMPOSE_FILE" restart
        success "Services restarted"
        ;;
    "backup")
        create_backup
        ;;
    "cleanup")
        cleanup_backups
        ;;
    "health")
        health_checks
        ;;
    *)
        echo "Usage: $0 {deploy|status|logs|stop|restart|backup|cleanup|health}"
        echo ""
        echo "Commands:"
        echo "  deploy  - Full deployment with health checks"
        echo "  status  - Show current deployment status"
        echo "  logs    - Show service logs (optional service name)"
        echo "  stop    - Stop all services"
        echo "  restart - Restart all services"
        echo "  backup  - Create backup only"
        echo "  cleanup - Clean up old backups"
        echo "  health  - Run health checks only"
        exit 1
        ;;
esac