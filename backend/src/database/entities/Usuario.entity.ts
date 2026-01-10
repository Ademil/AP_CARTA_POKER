import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index
} from 'typeorm';
import { Laudo } from './Laudo.entity';
import { Empresa } from './Empresa.entity';

export enum UserRole {
  ADMIN = 'admin',
  ENGENHEIRO_SENIOR = 'engenheiro_senior',
  ENGENHEIRO = 'engenheiro',
  TECNICO = 'tecnico',
  VISUALIZADOR = 'visualizador'
}

export enum AuthProvider {
  LOCAL = 'local',
  GOOGLE = 'google',
  MICROSOFT = 'microsoft'
}

@Entity('usuarios')
@Index(['email', 'empresaId'], { unique: true })
export class Usuario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  nome: string;

  @Column()
  email: string;

  @Column({ nullable: true })
  senhaHash?: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.ENGENHEIRO
  })
  role: UserRole;

  @Column({
    type: 'enum',
    enum: AuthProvider,
    default: AuthProvider.LOCAL
  })
  authProvider: AuthProvider;

  @Column({ nullable: true })
  providerId?: string; // ID do provedor externo (Google, Microsoft)

  @Column({ nullable: true })
  crea?: string;

  @Column({ nullable: true })
  uf?: string;

  @Column({ nullable: true })
  telefone?: string;

  @Column({ nullable: true })
  avatarUrl?: string;

  @Column({ type: 'jsonb', nullable: true })
  permissoes: string[];

  @Column({ default: true })
  ativo: boolean;

  @Column({ nullable: true })
  ultimoLogin?: Date;

  @Column({ nullable: true })
  emailVerificadoEm?: Date;

  @ManyToOne(() => Empresa, (empresa) => empresa.usuarios)
  @JoinColumn({ name: 'empresa_id' })
  empresa: Empresa;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @OneToMany(() => Laudo, (laudo) => laudo.responsavel)
  laudos: Laudo[];

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;

  // Métodos
  temPermissao(permissao: string): boolean {
    if (this.role === UserRole.ADMIN) return true;
    return this.permissoes?.includes(permissao) || false;
  }

  podeCriarLaudo(): boolean {
    return this.temPermissao('laudo:criar') || 
           [UserRole.ENGENHEIRO_SENIOR, UserRole.ENGENHEIRO, UserRole.TECNICO].includes(this.role);
  }

  podeAssinar(): boolean {
    return this.temPermissao('documento:assinar') || 
           [UserRole.ADMIN, UserRole.ENGENHEIRO_SENIOR].includes(this.role);
  }
}