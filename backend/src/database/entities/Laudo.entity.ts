import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index
} from 'typeorm';
import { Usuario } from './Usuario.entity';
import { Empresa } from './Empresa.entity';
import { Foto } from './Foto.entity';
import { Assinatura } from './Assinatura.entity';

export enum TipoAgente {
  RUIDO = 'ruido',
  CALOR = 'calor',
  FRIO = 'frio',
  UMIDADE = 'umidade',
  VIBRACAO = 'vibracao',
  RADIACAO_IONIZANTE = 'radiacao_ionizante',
  RADIACAO_NAO_IONIZANTE = 'radiacao_nao_ionizante',
  POEIRA_MINERAL = 'poeira_mineral',
  FUMOS_METALICOS = 'fumos_metalicos',
  GASES_VAPORES = 'gases_vapores',
  PRODUTOS_QUIMICOS = 'produtos_quimicos',
  AGENTES_BIOLOGICOS = 'agentes_biologicos',
  ERGONOMIA = 'ergonomia',
  PSICOSSOCIAL = 'psicossocial'
}

export enum GrauRisco {
  ALTO = 'alto',
  MEDIO = 'medio',
  BAIXO = 'baixo'
}

export enum StatusLaudo {
  RASCUNHO = 'rascunho',
  PENDENTE = 'pendente',
  ASSINADO = 'assinado',
  EXPIRADO = 'expirado',
  CANCELADO = 'cancelado'
}

@Entity('laudos')
@Index(['empresaId', 'numero'])
@Index(['responsavelId', 'criadoEm'])
export class Laudo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  numero: string; // Formato: LAU-2023-001

  @ManyToOne(() => Empresa, (empresa) => empresa.laudos)
  @JoinColumn({ name: 'empresa_id' })
  empresa: Empresa;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @ManyToOne(() => Usuario, (usuario) => usuario.laudos)
  @JoinColumn({ name: 'responsavel_id' })
  responsavel: Usuario;

  @Column({ name: 'responsavel_id' })
  responsavelId: string;

  @Column({
    type: 'enum',
    enum: TipoAgente
  })
  tipoAgente: TipoAgente;

  @Column()
  agenteDescricao: string;

  @Column({ type: 'text' })
  fonteGeradora: string;

  @Column({
    type: 'enum',
    enum: GrauRisco,
    default: GrauRisco.MEDIO
  })
  grauRisco: GrauRisco;

  @Column({
    type: 'enum',
    enum: StatusLaudo,
    default: StatusLaudo.RASCUNHO
  })
  status: StatusLaudo;

  // Dados técnicos
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  nivelExposicao?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  limiteTolerancia?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  excedente?: number;

  @Column({ nullable: true })
  unidadeMedida?: string;

  @Column({ type: 'int', default: 1 })
  trabalhadoresExpostos: number;

  // Localização
  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude?: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude?: number;

  @Column({ nullable: true })
  endereco?: string;

  @Column({ nullable: true })
  setor?: string;

  @Column({ nullable: true })
  posto?: string;

  // Metodologia
  @Column({ type: 'jsonb', nullable: true })
  normasReferencia: string[];

  @Column({ type: 'text', nullable: true })
  metodologia: string;

  @Column({ type: 'text', nullable: true })
  equipamentos: string;

  // Resultados
  @Column({ type: 'text' })
  conclusao: string;

  @Column({ type: 'text' })
  medidasControle: string;

  @Column({ type: 'text', nullable: true })
  recomendacoes: string;

  // Integração com NRs
  @Column({ type: 'jsonb', default: [] })
  nrsIntegradas: string[];

  // Documento gerado
  @Column({ nullable: true })
  documentoPdfUrl?: string;

  @Column({ nullable: true })
  documentoWordUrl?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadados: Record<string, any>;

  // Relações
  @OneToMany(() => Foto, (foto) => foto.laudo)
  fotos: Foto[];

  @OneToMany(() => Assinatura, (assinatura) => assinatura.laudo)
  assinaturas: Assinatura[];

  // Datas importantes
  @Column()
  dataAvaliacao: Date;

  @Column({ nullable: true })
  dataValidade?: Date;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;

  @Column({ nullable: true })
  assinadoEm?: Date;

  // Métodos
  gerarNumero(): string {
    const year = new Date().getFullYear();
    const seq = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `LAU-${year}-${seq}`;
  }

  calcularExcedente(): number | null {
    if (this.nivelExposicao && this.limiteTolerancia) {
      return this.nivelExposicao - this.limiteTolerancia;
    }
    return null;
  }

  estaExpirado(): boolean {
    if (!this.dataValidade) return false;
    return new Date() > this.dataValidade;
  }

  podeSerAssinado(): boolean {
    return this.status === StatusLaudo.PENDENTE || this.status === StatusLaudo.RASCUNHO;
  }
}