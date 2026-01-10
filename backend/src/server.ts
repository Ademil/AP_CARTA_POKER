import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { config } from './config';
import { connectDatabase } from './database';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/logger';
import { authenticate } from './middleware/auth';

// Importar rotas
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import laudoRoutes from './routes/laudo.routes';
import normaRoutes from './routes/norma.routes';
import syncRoutes from './routes/sync.routes';
import assinaturaRoutes from './routes/assinatura.routes';
import mapaRoutes from './routes/mapa.routes';
import fotoRoutes from './routes/foto.routes';
import backupRoutes from './routes/backup.routes';
import dashboardRoutes from './routes/dashboard.routes';

class App {
  public app: express.Application;
  public server: any;
  public io: Server;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: config.CORS_ORIGINS,
        credentials: true
      }
    });

    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeWebSocket();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares(): void {
    // Segurança
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", config.FRONTEND_URL]
        }
      }
    }));

    // CORS
    this.app.use(cors({
      origin: config.CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    // Rate Limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutos
      max: 100, // limite por IP
      message: 'Muitas requisições deste IP, tente novamente mais tarde.'
    });

    this.app.use('/api/', limiter);

    // Body parsers
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Compression
    this.app.use(compression());

    // Logging
    this.app.use(requestLogger);
  }

  private initializeRoutes(): void {
    // Rotas públicas
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/normas', normaRoutes);

    // Middleware de autenticação
    this.app.use(authenticate);

    // Rotas protegidas
    this.app.use('/api/users', userRoutes);
    this.app.use('/api/laudos', laudoRoutes);
    this.app.use('/api/sync', syncRoutes);
    this.app.use('/api/assinaturas', assinaturaRoutes);
    this.app.use('/api/mapas', mapaRoutes);
    this.app.use('/api/fotos', fotoRoutes);
    this.app.use('/api/backups', backupRoutes);
    this.app.use('/api/dashboard', dashboardRoutes);

    // Health check
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });
  }

  private initializeWebSocket(): void {
    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Autenticação necessária'));
        }

        // Verificar token JWT
        const decoded = jwt.verify(token, config.JWT_SECRET);
        socket.data.user = decoded;
        next();
      } catch (error) {
        next(new Error('Token inválido'));
      }
    });

    this.io.on('connection', (socket) => {
      console.log(`Usuário conectado: ${socket.data.user.userId}`);

      // Entrar na sala do usuário para notificações específicas
      socket.join(`user:${socket.data.user.userId}`);

      // Entrar na sala da empresa para updates em tempo real
      socket.join(`company:${socket.data.user.companyId}`);

      socket.on('disconnect', () => {
        console.log(`Usuário desconectado: ${socket.data.user.userId}`);
      });
    });
  }

  private initializeErrorHandling(): void {
    this.app.use(errorHandler);
  }

  public async start(): Promise<void> {
    try {
      // Conectar ao banco de dados
      await connectDatabase();

      // Iniciar servidor
      this.server.listen(config.PORT, () => {
        console.log(`
          🚀 Servidor SST iniciado na porta ${config.PORT}
          📍 Ambiente: ${config.NODE_ENV}
          🔗 URL: ${config.BASE_URL}
          📊 Banco de Dados: Conectado
          🔐 Autenticação: ${config.AUTH_PROVIDERS.join(', ')}
          ☁️ Sincronização: ${config.CLOUD_PROVIDERS.join(', ')}
        `);
      });
    } catch (error) {
      console.error('Erro ao iniciar servidor:', error);
      process.exit(1);
    }
  }
}

// Iniciar aplicação
const app = new App();
app.start();

export { app };