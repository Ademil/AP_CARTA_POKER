import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { config } from '../config';
import { Usuario, UserRole, AuthProvider } from '../database/entities/Usuario.entity';
import { AppDataSource } from '../database';
import { GoogleAuthService } from './google-auth.service';
import { MicrosoftAuthService } from './microsoft-auth.service';
import { EmailService } from './email.service';
import { RedisService } from './redis.service';

export interface LoginCredentials {
  email: string;
  senha: string;
}

export interface AuthResponse {
  usuario: Omit<Usuario, 'senhaHash'>;
  token: string;
  refreshToken: string;
  expiresIn: number;
}

export interface TokenPayload {
  userId: string;
  empresaId: string;
  role: UserRole;
  permissoes: string[];
}

export class AuthService {
  private userRepository = AppDataSource.getRepository(Usuario);
  private googleAuth = new GoogleAuthService();
  private microsoftAuth = new MicrosoftAuthService();
  private emailService = new EmailService();
  private redis = RedisService.getInstance();

  async loginLocal(credentials: LoginCredentials): Promise<AuthResponse> {
    const { email, senha } = credentials;

    // Buscar usuário
    const usuario = await this.userRepository.findOne({
      where: { email, authProvider: AuthProvider.LOCAL },
      relations: ['empresa']
    });

    if (!usuario || !usuario.ativo) {
      throw new Error('Credenciais inválidas ou usuário inativo');
    }

    // Verificar senha
    const senhaValida = await bcrypt.compare(senha, usuario.senhaHash!);
    if (!senhaValida) {
      throw new Error('Credenciais inválidas');
    }

    // Atualizar último login
    usuario.ultimoLogin = new Date();
    await this.userRepository.save(usuario);

    // Gerar tokens
    return this.generateAuthResponse(usuario);
  }

  async loginGoogle(code: string, redirectUri: string): Promise<AuthResponse> {
    // Obter tokens do Google
    const { tokens } = await this.googleAuth.getTokens(code, redirectUri);
    
    // Obter informações do usuário
    const userInfo = await this.googleAuth.getUserInfo(tokens.access_token!);

    // Buscar ou criar usuário
    let usuario = await this.userRepository.findOne({
      where: {
        email: userInfo.email,
        authProvider: AuthProvider.GOOGLE
      },
      relations: ['empresa']
    });

    if (!usuario) {
      // Criar novo usuário
      usuario = this.userRepository.create({
        nome: userInfo.name,
        email: userInfo.email,
        authProvider: AuthProvider.GOOGLE,
        providerId: userInfo.id,
        avatarUrl: userInfo.picture,
        emailVerificadoEm: userInfo.email_verified ? new Date() : undefined,
        ativo: true,
        role: UserRole.ENGENHEIRO,
        permissoes: []
      });

      // Associar à empresa padrão ou criar nova
      // (Implementação específica do negócio)
    }

    usuario.ultimoLogin = new Date();
    await this.userRepository.save(usuario);

    return this.generateAuthResponse(usuario);
  }

  async register(usuarioData: Partial<Usuario>, senha: string): Promise<AuthResponse> {
    // Verificar se email já existe
    const existingUser = await this.userRepository.findOne({
      where: { email: usuarioData.email }
    });

    if (existingUser) {
      throw new Error('Email já cadastrado');
    }

    // Hash da senha
    const senhaHash = await bcrypt.hash(senha, 12);

    // Criar usuário
    const usuario = this.userRepository.create({
      ...usuarioData,
      senhaHash,
      authProvider: AuthProvider.LOCAL,
      ativo: true
    });

    await this.userRepository.save(usuario);

    // Enviar email de verificação
    await this.sendVerificationEmail(usuario);

    return this.generateAuthResponse(usuario);
  }

  async refreshToken(refreshToken: string): Promise<AuthResponse> {
    // Verificar refresh token no Redis
    const userId = await this.redis.get(`refresh:${refreshToken}`);
    if (!userId) {
      throw new Error('Refresh token inválido');
    }

    // Buscar usuário
    const usuario = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['empresa']
    });

    if (!usuario || !usuario.ativo) {
      throw new Error('Usuário não encontrado ou inativo');
    }

    // Gerar novos tokens
    const response = await this.generateAuthResponse(usuario);

    // Invalidar refresh token antigo
    await this.redis.del(`refresh:${refreshToken}`);

    return response;
  }

  async logout(token: string, refreshToken?: string): Promise<void> {
    // Adicionar token à blacklist
    const decoded = jwt.decode(token) as TokenPayload;
    const expiresIn = decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 3600;
    
    await this.redis.setex(`blacklist:${token}`, expiresIn, 'true');

    // Invalidar refresh token
    if (refreshToken) {
      await this.redis.del(`refresh:${refreshToken}`);
    }
  }

  async resetPassword(email: string): Promise<void> {
    const usuario = await this.userRepository.findOne({ where: { email } });
    if (!usuario) {
      // Não revelar que o email não existe por segurança
      return;
    }

    // Gerar token de reset
    const resetToken = randomBytes(32).toString('hex');
    const resetExpires = Date.now() + 3600000; // 1 hora

    // Salvar no Redis
    await this.redis.setex(`reset:${resetToken}`, 3600, usuario.id);

    // Enviar email
    await this.emailService.sendPasswordReset(usuario.email, resetToken);
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.redis.get(`verify:${token}`);
    if (!userId) {
      throw new Error('Token de verificação inválido ou expirado');
    }

    const usuario = await this.userRepository.findOne({ where: { id: userId } });
    if (!usuario) {
      throw new Error('Usuário não encontrado');
    }

    usuario.emailVerificadoEm = new Date();
    await this.userRepository.save(usuario);

    await this.redis.del(`verify:${token}`);
  }

  private async generateAuthResponse(usuario: Usuario): Promise<AuthResponse> {
    // Payload do token
    const payload: TokenPayload = {
      userId: usuario.id,
      empresaId: usuario.empresaId,
      role: usuario.role,
      permissoes: usuario.permissoes || []
    };

    // Gerar access token
    const token = jwt.sign(payload, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN
    });

    // Gerar refresh token
    const refreshToken = randomBytes(64).toString('hex');
    const refreshExpires = 30 * 24 * 60 * 60; // 30 dias em segundos

    // Salvar refresh token no Redis
    await this.redis.setex(`refresh:${refreshToken}`, refreshExpires, usuario.id);

    // Calcular tempo de expiração
    const decoded = jwt.decode(token) as { exp: number };
    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

    // Remover senhaHash da resposta
    const { senhaHash, ...usuarioSemSenha } = usuario;

    return {
      usuario: usuarioSemSenha,
      token,
      refreshToken,
      expiresIn
    };
  }

  private async sendVerificationEmail(usuario: Usuario): Promise<void> {
    const verifyToken = randomBytes(32).toString('hex');
    
    // Salvar token no Redis por 24 horas
    await this.redis.setex(`verify:${verifyToken}`, 86400, usuario.id);

    await this.emailService.sendVerificationEmail(usuario.email, verifyToken);
  }

  async validateToken(token: string): Promise<TokenPayload> {
    try {
      // Verificar se está na blacklist
      const blacklisted = await this.redis.get(`blacklist:${token}`);
      if (blacklisted) {
        throw new Error('Token inválido');
      }

      const payload = jwt.verify(token, config.JWT_SECRET) as TokenPayload;
      return payload;
    } catch (error) {
      throw new Error('Token inválido ou expirado');
    }
  }

  // Middleware para verificar permissões
  static requirePermission(permission: string) {
    return (req: any, res: any, next: any) => {
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({ error: 'Não autorizado' });
      }

      if (user.role === UserRole.ADMIN) {
        return next();
      }

      if (!user.permissoes.includes(permission)) {
        return res.status(403).json({ 
          error: 'Permissão negada',
          required: permission,
          userPermissions: user.permissoes
        });
      }

      next();
    };
  }
}