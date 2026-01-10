@Entity('fotos')
@Index(['laudoId', 'tipo'])
export class Foto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Laudo, (laudo) => laudo.fotos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'laudo_id' })
  laudo: Laudo;

  @Column({ name: 'laudo_id' })
  laudoId: string;

  @Column()
  url: string;

  @Column({ nullable: true })
  thumbnailUrl?: string;

  @Column()
  nomeArquivo: string;

  @Column()
  tipoMime: string;

  @Column({ type: 'int' })
  tamanho: number; // em bytes

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude?: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude?: number;

  @Column({ type: 'jsonb', nullable: true })
  exifData: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  descricao?: string;

  @Column({
    type: 'enum',
    enum: ['evidencia', 'mapa', 'diagrama', 'outro'],
    default: 'evidencia'
  })
  tipo: string;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  // Métodos para processamento
  getPath(): string {
    return `uploads/fotos/${this.laudoId}/${this.id}.${this.getExtension()}`;
  }

  getExtension(): string {
    return this.nomeArquivo.split('.').pop() || 'jpg';
  }

  isImage(): boolean {
    return this.tipoMime.startsWith('image/');
  }
}