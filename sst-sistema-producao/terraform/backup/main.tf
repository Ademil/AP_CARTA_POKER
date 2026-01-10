# Configuração de Backup Automático S3

resource "aws_s3_bucket" "backups" {
  bucket = "sst-backups-${var.environment}"
  
  tags = {
    Name        = "sst-backups-${var.environment}"
    Environment = var.environment
    Backup      = "true"
  }
}

# Versionamento para recuperação de arquivos deletados acidentalmente
resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

# Encriptação
resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Política de lifecycle
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  
  rule {
    id     = "backup-transition"
    status = "Enabled"
    
    filter {
      prefix = "backups/"
    }
    
    transition {
      days          = 30
      storage_class = "GLACIER"
    }
    
    transition {
      days          = 90
      storage_class = "DEEP_ARCHIVE"
    }
    
    expiration {
      days = 365
    }
    
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Política de acesso
resource "aws_s3_bucket_policy" "backups" {
  bucket = aws_s3_bucket.backups.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RequireSSL"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:*"
        Resource = [
          aws_s3_bucket.backups.arn,
          "${aws_s3_bucket.backups.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        Sid    = "BackupAccess"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${var.account_id}:role/sst-backup-role"
        }
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:DeleteObject"
        ]
        Resource = [
          aws_s3_bucket.backups.arn,
          "${aws_s3_bucket.backups.arn}/*"
        ]
      }
    ]
  })
}

# KMS Key para encriptação de secrets
resource "aws_kms_key" "backup_key" {
  description             = "KMS key para backup do SST"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  
  tags = {
    Name        = "sst-backup-key"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "backup_key_alias" {
  name          = "alias/sst-backup-key"
  target_key_id = aws_kms_key.backup_key.key_id
}

# EventBridge para agendar backups
resource "aws_cloudwatch_event_rule" "backup_schedule" {
  name                = "sst-backup-schedule"
  description         = "Agenda backups diários do SST"
  schedule_expression = "cron(0 2 * * ? *)"  # 2 AM daily
}

resource "aws_cloudwatch_event_target" "backup_lambda" {
  rule      = aws_cloudwatch_event_rule.backup_schedule.name
  target_id = "trigger-backup-lambda"
  arn       = aws_lambda_function.backup_executor.arn
}

# Lambda function para executar backups
resource "aws_lambda_function" "backup_executor" {
  filename      = "backup_lambda.zip"
  function_name = "sst-backup-executor"
  role          = aws_iam_role.backup_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  timeout       = 300
  memory_size   = 512
  
  environment {
    variables = {
      S3_BUCKET       = aws_s3_bucket.backups.bucket
      RETENTION_DAYS  = "30"
      ENCRYPT_KEY_ID  = aws_kms_key.backup_key.key_id
    }
  }
  
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_sg_id]
  }
}

# IAM Role para Lambda
resource "aws_iam_role" "backup_lambda_role" {
  name = "sst-backup-lambda-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "backup_lambda_basic" {
  role       = aws_iam_role.backup_lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "backup_lambda_s3" {
  name = "sst-backup-s3-access"
  role = aws_iam_role.backup_lambda_role.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:DeleteObject"
        ]
        Resource = [
          aws_s3_bucket.backups.arn,
          "${aws_s3_bucket.backups.arn}/*"
        ]
      }
    ]
  })
}

# Configuração de backup cross-region
resource "aws_s3_bucket_replication_configuration" "backup_replication" {
  bucket = aws_s3_bucket.backups.id
  role   = aws_iam_role.replication.arn
  
  rule {
    id     = "cross-region-replication"
    status = "Enabled"
    
    destination {
      bucket        = aws_s3_bucket.backup_dr.arn
      storage_class = "STANDARD"
    }
    
    filter {
      prefix = "backups/"
    }
  }
}

# Bucket DR em outra região
resource "aws_s3_bucket" "backup_dr" {
  provider = aws.dr_region
  bucket   = "sst-backups-dr-${var.environment}"
  
  tags = {
    Name        = "sst-backups-dr-${var.environment}"
    Environment = var.environment
    Backup      = "true"
    DR          = "true"
  }
}

# Monitoramento de backups
resource "aws_cloudwatch_dashboard" "backup_dashboard" {
  dashboard_name = "sst-backup-monitoring"
  
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        
        properties = {
          metrics = [
            ["AWS/Lambda", "Duration", { "stat": "Average", "label": "Backup Duration" }]
          ]
          period = 300
          stat   = "Average"
          region = var.region
          title  = "Backup Performance"
        }
      }
    ]
  })
}

# Alertas de backup
resource "aws_cloudwatch_metric_alarm" "backup_failure" {
  alarm_name          = "sst-backup-failure"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = "300"
  statistic           = "Sum"
  threshold           = "0"
  
  alarm_description = "Alerta quando backup falha"
  alarm_actions     = [var.sns_topic_arn]
  
  dimensions = {
    FunctionName = aws_lambda_function.backup_executor.function_name
  }
}