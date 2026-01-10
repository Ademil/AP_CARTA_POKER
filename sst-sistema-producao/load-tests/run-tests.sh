#!/bin/bash

# Script de execução de Load Tests para Sistema SST

set -e

# Configurações
ENVIRONMENT=${1:-staging}
TEST_TYPE=${2:-normal}
REPORT_DIR="reports/$(date +%Y%m%d-%H%M%S)"
K6_IMAGE="grafana/k6:latest"

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

load_environment() {
    log "Carregando ambiente: $ENVIRONMENT"
    
    if [ ! -f ".env.$ENVIRONMENT" ]; then
        error "Arquivo .env.$ENVIRONMENT não encontrado"
        exit 1
    fi
    
    export $(cat .env.$ENVIRONMENT | xargs)
    export TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    
    log "Ambiente carregado: BASE_URL=$BASE_URL"
}

select_test() {
    case $TEST_TYPE in
        "smoke")
            echo "k6-tests.js --env ENV=$ENVIRONMENT --out influxdb=http://influxdb:8086/k6"
            ;;
        "normal")
            echo "k6-tests.js --env ENV=$ENVIRONMENT --stage 5m:100,10m:200,5m:100"
            ;;
        "stress")
            echo "k6-tests.js --env ENV=$ENVIRONMENT --vus 500 --duration 30m"
            ;;
        "spike")
            echo "k6-tests.js --env ENV=$ENVIRONMENT --stage 1m:1000,5m:1000,1m:100"
            ;;
        "endurance")
            echo "k6-tests.js --env ENV=$ENVIRONMENT --vus 100 --duration 2h"
            ;;
        *)
            error "Tipo de teste inválido: $TEST_TYPE"
            exit 1
            ;;
    esac
}

run_docker_test() {
    local test_cmd=$1
    
    log "Executando teste no Docker..."
    
    docker run --rm \
        -v "$(pwd):/scripts" \
        -v "$(pwd)/$REPORT_DIR:/reports" \
        -e BASE_URL="$BASE_URL" \
        -e API_KEY="$API_KEY" \
        -e USER_EMAIL="$LOAD_TEST_USER" \
        -e USER_PASSWORD="$LOAD_TEST_PASSWORD" \
        -e ENV="$ENVIRONMENT" \
        -e TIMESTAMP="$TIMESTAMP" \
        $K6_IMAGE run \
        --include-system-env-vars \
        /scripts/$test_cmd \
        --out json=/reports/metrics.json \
        --out influxdb="http://$INFLUXDB_HOST:8086/k6" \
        --tag test_type="$TEST_TYPE" \
        --tag environment="$ENVIRONMENT"
}

run_local_test() {
    local test_cmd=$1
    
    log "Executando teste local..."
    
    k6 run \
        --env ENV="$ENVIRONMENT" \
        --env BASE_URL="$BASE_URL" \
        --env API_KEY="$API_KEY" \
        --out json="$REPORT_DIR/metrics.json" \
        --out influxdb="http://$INFLUXDB_HOST:8086/k6" \
        --tag test_type="$TEST_TYPE" \
        --tag environment="$ENVIRONMENT" \
        "load-tests/$test_cmd"
}

check_prerequisites() {
    log "Verificando pré-requisitos..."
    
    # Verificar se o sistema está respondendo
    local health_check=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
    
    if [ "$health_check" != "200" ]; then
        error "Sistema não está respondendo em $BASE_URL"
        exit 1
    fi
    
    # Verificar banco de dados de métricas
    if ! curl -s "http://$INFLUXDB_HOST:8086/health" | grep -q "ready"; then
        warn "InfluxDB não está disponível, métricas não serão salvas"
    fi
    
    log "Pré-requisitos verificados"
}

generate_report() {
    log "Gerando relatório..."
    
    # Converter JSON para CSV para análise
    if [ -f "$REPORT_DIR/metrics.json" ]; then
        jq -r '.metrics[] | select(.type=="trend") | [.name, .values.avg, .values.min, .values.max, .values.med] | @csv' \
            "$REPORT_DIR/metrics.json" > "$REPORT_DIR/summary.csv"
    fi
    
    # Gerar gráficos com gnuplot se disponível
    if command -v gnuplot &> /dev/null; then
        cat > "$REPORT_DIR/generate_plots.gp" << 'EOF'
set terminal png size 1600,900
set output 'response_times.png'
set title 'Tempo de Resposta por Endpoint'
set xlabel 'Percentil'
set ylabel 'Tempo (ms)'
set datafile separator ','
plot 'response_data.csv' using 1:2 with lines title 'P95', \
     '' using 1:3 with lines title 'P99'
EOF
    fi
    
    # Criar relatório HTML simples
    cat > "$REPORT_DIR/index.html" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Load Test Report - SST System</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .metric { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 5px; }
        .pass { color: green; }
        .fail { color: red; }
    </style>
</head>
<body>
    <h1>Load Test Report - Sistema SST</h1>
    <p><strong>Data:</strong> $(date)</p>
    <p><strong>Ambiente:</strong> $ENVIRONMENT</p>
    <p><strong>Tipo de Teste:</strong> $TEST_TYPE</p>
    
    <h2>Resultados</h2>
    <div class="metric">
        <h3>Performance</h3>
        <p>Requests: <span id="requests">Carregando...</span></p>
        <p>Duração média: <span id="avg_duration">Carregando...</span>ms</p>
        <p>Taxa de erro: <span id="error_rate">Carregando...</span>%</p>
    </div>
</body>
</html>
EOF
    
    log "Relatório gerado em: $REPORT_DIR"
}

send_notification() {
    local status=$1
    
    if [ "$status" = "success" ]; then
        local message="✅ Load Test $TEST_TYPE concluído em $ENVIRONMENT"
        local color="#36a64f"
    else
        local message="❌ Load Test $TEST_TYPE falhou em $ENVIRONMENT"
        local color="#ff0000"
    fi
    
    # Enviar para Slack
    curl -X POST -H 'Content-type: application/json' \
        --data "{
            \"attachments\": [{
                \"color\": \"$color\",
                \"title\": \"Load Test Report\",
                \"text\": \"$message\",
                \"fields\": [
                    {
                        \"title\": \"Environment\",
                        \"value\": \"$ENVIRONMENT\",
                        \"short\": true
                    },
                    {
                        \"title\": \"Test Type\",
                        \"value\": \"$TEST_TYPE\",
                        \"short\": true
                    }
                ]
            }]
        }" \
        "$SLACK_WEBHOOK_URL"
    
           # Enviar métricas para alerting
        if [ -f "$REPORT_DIR/metrics.json" ]; then
            local error_rate=$(jq '.metrics["http_req_failed"].value' "$REPORT_DIR/metrics.json")
            local avg_duration=$(jq '.metrics["http_req_duration"].values.avg' "$REPORT_DIR/metrics.json")
            
            # Enviar para sistema de métricas (ex: Prometheus, DataDog)
            if [ -n "$METRICS_ENDPOINT" ]; then
                curl -X POST "$METRICS_ENDPOINT" \
                    -H "Content-Type: application/json" \
                    -d "{
                        \"test_type\": \"$TEST_TYPE\",
                        \"environment\": \"$ENVIRONMENT\",
                        \"error_rate\": $error_rate,
                        \"avg_duration\": $avg_duration,
                        \"timestamp\": \"$(date -Iseconds)\"
                    }"
            fi
        fi
    fi
}

main() {
    log "Iniciando Load Test - Sistema SST"
    log "Ambiente: $ENVIRONMENT | Tipo: $TEST_TYPE"
    
    # Criar diretório de relatórios
    mkdir -p "$REPORT_DIR"
    
    # Carregar variáveis de ambiente
    load_environment
    
    # Verificar pré-requisitos
    check_prerequisites
    
    # Selecionar configuração do teste
    test_config=$(select_test)
    log "Configuração do teste: $test_config"
    
    # Executar teste
    local start_time=$(date +%s)
    
    if [ -n "$RUN_IN_DOCKER" ] && [ "$RUN_IN_DOCKER" = "true" ]; then
        run_docker_test "$test_config"
    else
        run_local_test "$test_config"
    fi
    
    local exit_code=$?
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Processar resultados
    if [ $exit_code -eq 0 ]; then
        log "Teste concluído com sucesso em ${duration}s"
        generate_report
        send_notification "success"
    else
        error "Teste falhou com código: $exit_code"
        send_notification "failure"
        exit $exit_code
    fi
    
    log "Load Test finalizado. Relatórios em: $REPORT_DIR"
}

# Tratamento de sinais
trap 'error "Interrompido pelo usuário"; send_notification "failure"; exit 1' INT TERM

# Execução principal
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Validação de argumentos
    if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
        error "Ambiente inválido. Use: dev, staging, prod"
        exit 1
    fi
    
    if [[ ! "$TEST_TYPE" =~ ^(smoke|normal|stress|spike|endurance)$ ]]; then
        error "Tipo de teste inválido. Use: smoke, normal, stress, spike, endurance"
        exit 1
    fi
    
    main
fi