terraform {
  required_version = ">= 1.0"
  
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
    
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "s3" {
    bucket = "sst-terraform-state"
    key    = "dns/terraform.tfstate"
    region = "us-east-1"
    
    dynamodb_table = "sst-terraform-locks"
    encrypt        = true
  }
}

# Variáveis
variable "domain" {
  description = "Domínio principal do Sistema SST"
  type        = string
  default     = "segurancadotrabalho.com"
}

variable "environment" {
  description = "Ambiente (production, staging, development)"
  type        = string
  default     = "production"
}

variable "cloudflare_zone_id" {
  description = "Zone ID no Cloudflare"
  type        = string
  sensitive   = true
}

variable "aws_region" {
  description = "Região AWS"
  type        = string
  default     = "us-east-1"
}

# Provedores
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "aws" {
  region = var.aws_region
}

# Configuração de zona DNS no Cloudflare
resource "cloudflare_zone" "sst_domain" {
  zone = var.domain
  plan = "business"  # Para WAF e outras funcionalidades
}

# Registros A para produção
resource "cloudflare_record" "production_a" {
  zone_id = cloudflare_zone.sst_domain.id
  name    = "@"
  value   = aws_eip.production.public_ip
  type    = "A"
  ttl     = 1  # Auto TTL com Cloudflare
  proxied = true  # Proxy através do Cloudflare
  
  depends_on = [aws_eip.production]
}

resource "cloudflare_record" "www_cname" {
  zone_id = cloudflare_zone.sst_domain.id
  name    = "www"
  value   = var.domain
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

# Subdomínios para ambientes
resource "cloudflare_record" "staging_a" {
  zone_id = cloudflare_zone.sst_domain.id
  name    = "staging"
  value   = aws_eip.staging.public_ip
  type    = "A"
  ttl     = 1
  proxied = true
  
  depends_on = [aws_eip.staging]
}

resource "cloudflare_record" "api_cname" {
  zone_id = cloudflare_zone.sst_domain.id
  name    = "api"
  value   = var.domain
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

# Registros para serviços específicos
resource "cloudflare_record" "monitoring_a" {
  zone_id = cloudflare_zone.sst_domain.id
  name    = "monitoring"
  value   = aws_eip.monitoring.public_ip
  type    = "A"
  ttl     = 1
  proxied = false  # Não proxy para acesso direto
  
  depends_on = [aws_eip.monitoring]
}

# Registros MX para email
resource "cloudflare_record" "mx" {
  zone_id  = cloudflare_zone.sst_domain.id
  name     = "@"
  value    = "mail.${var.domain}"
  type     = "MX"
  ttl      = 1
  priority = 10
}

# Registros TXT para verificação e segurança
resource "cloudflare_record" "dmarc" {
  zone_id = cloudflare_zone.sst_domain.id
  name    = "_dmarc"
  value   = "v=DMARC1; p=quarantine; rua=mailto:dmarc@${var.domain}; ruf=mailto:dmarc@${var.domain};"
  type    = "TXT"
  ttl     = 1
}

resource "cloudflare_record" "spf" {
  zone_id = cloudflare_zone.sst_domain.id
  name    = "@"
  value   = "v=spf1 include:_spf.google.com include:servers.mcsv.net ~all"
  type    = "TXT"
  ttl     = 1
}

resource "cloudflare_record" "dkim" {
  zone_id = cloudflare_zone.sst_domain.id
  name    = "google._domainkey"
  value   = "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC..."
  type    = "TXT"
  ttl     = 1
}

# Registros para certificados SSL
resource "cloudflare_record" "acme_challenge" {
  zone_id = cloudflare_zone.sst_domain.id
  name    = "_acme-challenge"
  value   = "challenge-value"
  type    = "TXT"
  ttl     = 120
  
  lifecycle {
    ignore_changes = [value]
  }
}

# Configuração de Page Rules
resource "cloudflare_page_rule" "https_redirect" {
  zone_id = cloudflare_zone.sst_domain.id
  target  = "*.${var.domain}/*"
  
  actions {
    always_use_https = true
  }
  
  priority = 1
  status   = "active"
}

resource "cloudflare_page_rule" "cache_static" {
  zone_id = cloudflare_zone.sst_domain.id
  target  = "*.${var.domain}/static/*"
  
  actions {
    cache_level            = "cache_everything"
    edge_cache_ttl         = 31536000  # 1 ano
    browser_cache_ttl      = 31536000
    cache_by_device_type   = true
    cache_deception_armor  = true
  }
  
  priority = 2
  status   = "active"
}

# Configuração de WAF
resource "cloudflare_ruleset" "waf" {
  zone_id     = cloudflare_zone.sst_domain.id
  name        = "SST WAF Rules"
  description = "Regras WAF para o Sistema SST"
  kind        = "zone"
  phase       = "http_request_firewall_custom"
  
  rules {
    action = "block"
    expression = "(http.request.uri.path contains \"/wp-admin\" or http.request.uri.path contains \"/wp-login\")"
    description = "Block WordPress paths"
    enabled = true
  }
  
  rules {
    action = "block"
    expression = "(http.request.uri.path contains \".env\" or http.request.uri.path contains \"/config\" or http.request.uri.path contains \"/.git\")"
    description = "Block sensitive files"
    enabled = true
  }
  
  rules {
    action = "managed_challenge"
    expression = "(cf.threat_score gt 14)"
    description = "Challenge high threat score"
    enabled = true
  }
}

# Configuração de Rate Limiting
resource "cloudflare_rate_limit" "api_limit" {
  zone_id = cloudflare_zone.sst_domain.id
  
  threshold = 100
  period    = 60
  
  match {
    request {
      url_pattern = "api.${var.domain}/api/*"
      schemes     = ["HTTP", "HTTPS"]
      methods     = ["POST", "PUT", "DELETE"]
    }
    
    response {
      statuses       = [200, 201, 204]
      origin_traffic = true
    }
  }
  
  action {
    mode    = "simulate"
    timeout = 60
    
    response {
      content_type = "application/json"
      body         = "{\"error\": \"Rate limit exceeded\", \"retry_after\": 60}"
    }
  }
  
  disabled    = false
  description = "Rate limit para API"
}

# Configuração de Load Balancer
resource "cloudflare_load_balancer" "sst_lb" {
  zone_id          = cloudflare_zone.sst_domain.id
  name             = "sst-load-balancer"
  steering_policy  = "random"
  
  default_pool_ids = [
    cloudflare_load_balancer_pool.backend_pool_1.id,
    cloudflare_load_balancer_pool.backend_pool_2.id
  ]
  
  fallback_pool_id = cloudflare_load_balancer_pool.backend_pool_1.id
  
  session_affinity = "cookie"
  session_affinity_ttl = 82800  # 23 horas
  
  rules {
    name     = "API Routing"
    condition = "http.request.uri.path contains \"/api/\""
    overrides {
      session_affinity = "ip"
      session_affinity_ttl = 14400  # 4 horas
    }
  }
  
  rules {
    name     = "Static Assets"
    condition = "http.request.uri.path matches \"^/static/.*\""
    fixed_response {
      message_body = "Static content"
      status_code  = 200
      content_type = "text/html"
    }
  }
}

# Pools do Load Balancer
resource "cloudflare_load_balancer_pool" "backend_pool_1" {
  account_id = var.cloudflare_account_id
  name       = "backend-pool-1"
  
  origins {
    name    = "backend-1"
    address = "10.0.1.10"
    enabled = true
    weight  = 1
  }
  
  origins {
    name    = "backend-2"
    address = "10.0.1.11"
    enabled = true
    weight  = 1
  }
  
  monitor = cloudflare_load_balancer_monitor.backend_monitor.id
  
  notification_email = "infra@sst.com"
  
  latitude  = -23.550520
  longitude = -46.633308
}

resource "cloudflare_load_balancer_monitor" "backend_monitor" {
  account_id     = var.cloudflare_account_id
  description    = "Monitor backend servers"
  type           = "https"
  interval       = 60
  timeout        = 5
  retries        = 2
  method         = "GET"
  path           = "/health"
  expected_codes = "200"
  
  header {
    header = "Host"
    values = ["api.${var.domain}"]
  }
}

# AWS Resources para DNS
resource "aws_eip" "production" {
  domain = "vpc"
  tags = {
    Name = "sst-production-ip"
    Environment = "production"
  }
}

resource "aws_eip" "staging" {
  domain = "vpc"
  tags = {
    Name = "sst-staging-ip"
    Environment = "staging"
  }
}

resource "aws_eip" "monitoring" {
  domain = "vpc"
  tags = {
    Name = "sst-monitoring-ip"
    Environment = "monitoring"
  }
}

# Outputs
output "nameservers" {
  description = "Nameservers do domínio"
  value       = cloudflare_zone.sst_domain.name_servers
  sensitive   = false
}

output "domain_status" {
  description = "Status do domínio"
  value       = cloudflare_zone.sst_domain.status
}

output "production_ip" {
  description = "IP de produção"
  value       = aws_eip.production.public_ip
}

output "staging_ip" {
  description = "IP de staging"
  value       = aws_eip.staging.public_ip
}