import dotenv from 'dotenv';
import path from 'path';

// Carregar variáveis de ambiente
dotenv.config({ path: path.join(__dirname, '../../.env') });

const config = {
  // Servidor
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  CORS_ORIGINS: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],

  // Banco de Dados
  DB_TYPE: process.env.DB_TYPE || 'postgres',
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
  DB_USERNAME: process.env.DB_USERNAME || 'sst_user',
  DB_PASSWORD: process.env.DB_PASSWORD || 'sst_password',
  DB_DATABASE: process.env.DB_DATABASE || 'sst_database',
  DB_SYNCHRONIZE: process.env.NODE_ENV === 'development',
  DB_LOGGING: process.env.NODE_ENV === 'development',

  // Redis (para cache e filas)
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'sst_super_secret_key_change_in_production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || 'sst_refresh_secret_key',
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d',

  // OAuth2
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID || '',
  MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET || '',

  // Cloud Storage
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || '',
  S3_SECRET_KEY: process.env.S3_SECRET_KEY || '',
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME || '',
  S3_REGION: process.env.S3_REGION || 'us-east-1',

  // APIs Externas
  GOV_BR_API_KEY: process.env.GOV_BR_API_KEY || '',
  GOV_BR_API_URL: process.env.GOV_BR_API_URL || 'https://api.gov.br',
  
  // ICP-Brasil
  ICP_BRASIL_CERT_PATH: process.env.ICP_BRASIL_CERT_PATH || '',
  ICP_BRASIL_KEY_PATH: process.env.ICP_BRASIL_KEY_PATH || '',
  ICP_BRASIL_PASSWORD: process.env.ICP_BRASIL_PASSWORD || '',

  // Email
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',

  // Configurações de Upload
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
  UPLOAD_PATH: process.env.UPLOAD_PATH || 'uploads',

  // Configurações de Backup
  BACKUP_PATH: process.env.BACKUP_PATH || 'backups',
  BACKUP_CRON: process.env.BACKUP_CRON || '0 2 * * *', // 2 AM daily

  // Lista de provedores configurados
  AUTH_PROVIDERS: ['local', 'google', 'microsoft'],
  CLOUD_PROVIDERS: ['google-drive', 'onedrive', 's3']
} as const;

export { config };