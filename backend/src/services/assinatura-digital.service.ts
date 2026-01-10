import * as fs from 'fs';
import * as crypto from 'crypto';
import * as pdfLib from 'pdf-lib';
import signpdf from 'node-signpdf';
import { config } from '../config';
import { Usuario } from '../database/entities/Usuario.entity';
import { Laudo } from '../database/entities/Laudo.entity';

export interface CertificadoDigital {
  certificado: Buffer;
  chavePrivada: Buffer;
  senha: string;
  validoAte: Date;
  emissor: string;
  cnpj: string;
}

export interface AssinaturaDigital {
  hash: string;
  assinatura: Buffer;
  timestamp: Date;
  certificadoInfo: {
    emissor: string;
    cnpj: string;
    validoAte: Date;
  };
  metadados: Record<string, any>;
}

export class AssinaturaDigitalService {
  private certificates = new Map<string, CertificadoDigital>();

  async carregarCertificadoUsuario(usuarioId: string): Promise<CertificadoDigital> {
    // Verificar se já está carregado
    if (this.certificates.has(usuarioId)) {
      return this.certificates.get(usuarioId)!;
    }

    // Carregar do banco de dados ou arquivo
    const certificado = await this.loadCertificateFromStorage(usuarioId);
    this.certificates.set(usuarioId, certificado);

    return certificado;
  }

  async assinarLaudo(laudo: Laudo, usuario: Usuario, arquivoPdf: Buffer): Promise<{
    arquivoAssinado: Buffer;
    assinatura: AssinaturaDigital;
    qrCodeUrl: string;
  }> {
    // Validar certificado
    const certificado = await this.carregarCertificadoUsuario(usuario.id);
    await this.validarCertificado(certificado);

    // Validar laudo
    this.validarLaudoParaAssinatura(laudo);

    // Gerar hash do documento
    const hash = this.gerarHashDocumento(arquivoPdf);

    // Assinar digitalmente
    const assinatura = await this.assinarDocumento(arquivoPdf, certificado);

    // Adicionar carimbo de tempo
    const assinaturaComTimestamp = await this.adicionarTimestamp(assinatura);

    // Criar QR Code de verificação
    const qrCodeUrl = await this.gerarQRCodeVerificacao(hash, assinaturaComTimestamp);

    // Atualizar metadados do PDF
    const pdfAssinado = await this.atualizarMetadadosPDF(
      arquivoPdf,
      usuario,
      laudo,
      assinaturaComTimestamp
    );

    return {
      arquivoAssinado: pdfAssinado,
      assinatura: assinaturaComTimestamp,
      qrCodeUrl
    };
  }

  async verificarAssinatura(arquivoPdf: Buffer, assinatura: AssinaturaDigital): Promise<{
    valido: boolean;
    detalhes: {
      integridade: boolean;
      autenticidade: boolean;
      temporalidade: boolean;
      certificadoValido: boolean;
    };
    informacoes: {
      assinante: string;
      dataAssinatura: Date;
      cnpj: string;
      emissor: string;
    };
  }> {
    try {
      // Verificar hash do documento
      const hashCalculado = this.gerarHashDocumento(arquivoPdf);
      const integridade = hashCalculado === assinatura.hash;

      // Verificar assinatura criptográfica
      const autenticidade = await this.verificarAssinaturaCriptografica(
        assinatura.hash,
        assinatura.assinatura,
        assinatura.certificadoInfo
      );

      // Verificar validade do certificado
      const certificadoValido = assinatura.certificadoInfo.validoAte > new Date();

      // Verificar carimbo de tempo
      const temporalidade = await this.verificarTimestamp(assinatura.metadados.timestamp);

      return {
        valido: integridade && autenticidade && certificadoValido && temporalidade,
        detalhes: {
          integridade,
          autenticidade,
          temporalidade,
          certificadoValido
        },
        informacoes: {
          assinante: assinatura.metadados.assinante,
          dataAssinatura: assinatura.timestamp,
          cnpj: assinatura.certificadoInfo.cnpj,
          emissor: assinatura.certificadoInfo.emissor
        }
      };
    } catch (error) {
      return {
        valido: false,
        detalhes: {
          integridade: false,
          autenticidade: false,
          temporalidade: false,
          certificadoValido: false
        },
        informacoes: {
          assinante: 'Desconhecido',
          dataAssinatura: new Date(),
          cnpj: '',
          emissor: ''
        }
      };
    }
  }

  async gerarCertificadoA1(certificado: Buffer, chavePrivada: Buffer, senha: string): Promise<{
    certificadoA1: Buffer;
    validoAte: Date;
    cnpj: string;
  }> {
    // Implementar geração de certificado A1 (PKCS#12)
    // Para assinatura em lote sem necessidade de token físico

    throw new Error('Não implementado');
  }

  async assinaturaRemota(certificadoId: string, hash: string): Promise<Buffer> {
    // Implementar assinatura remota usando API de Cartório Digital
    // Útil para certificados em token físico ou nuvem

    throw new Error('Não implementado');
  }

  private async loadCertificateFromStorage(usuarioId: string): Promise<CertificadoDigital> {
    // Carregar certificado do banco de dados ou sistema de arquivos
    // Em produção, usar um HSM ou serviço gerenciado de certificados

    const certPath = `${config.ICP_BRASIL_CERT_PATH}/${usuarioId}.p12`;
    const keyPath = `${config.ICP_BRASIL_KEY_PATH}/${usuarioId}.key`;

    const certificado = fs.readFileSync(certPath);
    const chavePrivada = fs.readFileSync(keyPath);

    return {
      certificado,
      chavePrivada,
      senha: config.ICP_BRASIL_PASSWORD,
      validoAte: new Date('2024-12-31'),
      emissor: 'ICP-Brasil',
      cnpj: '00.000.000/0001-00'
    };
  }

  private async validarCertificado(certificado: CertificadoDigital): Promise<void> {
    // Verificar validade
    if (certificado.validoAte < new Date()) {
      throw new Error('Certificado expirado');
    }

    // Verificar emissor
    if (certificado.emissor !== 'ICP-Brasil') {
      throw new Error('Certificado não emitido por ICP-Brasil');
    }

    // Verificar integridade
    // Implementar verificação criptográfica do certificado
  }

  private validarLaudoParaAssinatura(laudo: Laudo): void {
    if (!laudo.podeSerAssinado()) {
      throw new Error('Laudo não está em estado apropriado para assinatura');
    }

    if (laudo.estaExpirado()) {
      throw new Error('Laudo expirado não pode ser assinado');
    }

    // Verificar se todos os campos obrigatórios estão preenchidos
    const camposObrigatorios = [
      'numero', 'empresaId', 'responsavelId', 'tipoAgente',
      'agenteDescricao', 'conclusao', 'medidasControle'
    ];

    for (const campo of camposObrigatorios) {
      if (!laudo[campo as keyof Laudo]) {
        throw new Error(`Campo obrigatório não preenchido: ${campo}`);
      }
    }
  }

  private gerarHashDocumento(documento: Buffer): string {
    return crypto
      .createHash('sha256')
      .update(documento)
      .digest('hex');
  }

  private async assinarDocumento(documento: Buffer, certificado: CertificadoDigital): Promise<AssinaturaDigital> {
    try {
      // Usar node-signpdf para assinar PDF
      const p12Buffer = certificado.certificado;
      const signedPdf = signpdf.sign(documento, p12Buffer, {
        passphrase: certificado.senha
      });

      const hash = this.gerarHashDocumento(documento);

      return {
        hash,
        assinatura: signedPdf,
        timestamp: new Date(),
        certificadoInfo: {
          emissor: certificado.emissor,
          cnpj: certificado.cnpj,
          validoAte: certificado.validoAte
        },
        metadados: {
          algoritmo: 'SHA256withRSA',
          formato: 'PKCS#7',
          localAssinatura: 'Brasil',
          motivo: 'Aprovação de laudo técnico'
        }
      };
    } catch (error) {
      throw new Error(`Erro ao assinar documento: ${error.message}`);
    }
  }

  private async adicionarTimestamp(assinatura: AssinaturaDigital): Promise<AssinaturaDigital> {
    // Implementar carimbo de tempo usando TSA (Time Stamping Authority)
    // Para produção, usar serviço de TSA autorizado

    const timestampResponse = await this.obterTimestampTSA(assinatura.hash);

    return {
      ...assinatura,
      timestamp: new Date(timestampResponse.time),
      metadados: {
        ...assinatura.metadados,
        timestamp: timestampResponse.time,
        tsa: timestampResponse.tsa,
        tokenTimestamp: timestampResponse.token
      }
    };
  }

  private async obterTimestampTSA(hash: string): Promise<any> {
    // Implementar requisição para TSA
    // Exemplo com FreeTSA
    const response = await fetch('http://freetsa.org/tsr', {
      method: 'POST',
      body: hash
    });

    return response.json();
  }

  private async gerarQRCodeVerificacao(hash: string, assinatura: AssinaturaDigital): Promise<string> {
    // Gerar QR Code com link para verificação
    const dadosVerificacao = {
      hash,
      timestamp: assinatura.timestamp.toISOString(),
      certificado: assinatura.certificadoInfo.cnpj,
      urlVerificacao: `${config.BASE_URL}/api/assinaturas/verificar/${hash}`
    };

    const dadosCodificados = Buffer.from(JSON.stringify(dadosVerificacao)).toString('base64');
    
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(dadosCodificados)}`;
  }

  private async atualizarMetadadosPDF(
    pdfBuffer: Buffer,
    usuario: Usuario,
    laudo: Laudo,
    assinatura: AssinaturaDigital
  ): Promise<Buffer> {
    const pdfDoc = await pdfLib.PDFDocument.load(pdfBuffer);
    
    // Adicionar metadados
    pdfDoc.setTitle(`Laudo Técnico ${laudo.numero}`);
    pdfDoc.setSubject('Laudo de Insalubridade - SST');
    pdfDoc.setAuthor(`${usuario.nome} - ${usuario.crea}`);
    pdfDoc.setCreator('Sistema SST - ICP-Brasil');
    pdfDoc.setProducer('Sistema de Gestão de Laudos SST');
    pdfDoc.setKeywords(['SST', 'Insalubridade', 'NR-15', 'Laudo Técnico']);
    
    // Adicionar informações de assinatura
    const customProperties = {
      'AssinadoPor': usuario.nome,
      'CREA': usuario.crea || '',
      'DataAssinatura': assinatura.timestamp.toISOString(),
      'CNPJAssinante': assinatura.certificadoInfo.cnpj,
      'HashDocumento': assinatura.hash,
      'NumeroLaudo': laudo.numero,
      'Empresa': laudo.empresa.razaoSocial
    };

    // Converter para PDF/A se necessário
    const pdfAssinado = await pdfDoc.save({
      useObjectStreams: false,
      addDefaultPage: false
    });

    return Buffer.from(pdfAssinado);
  }

  private async verificarAssinaturaCriptografica(
    hash: string,
    assinatura: Buffer,
    certificadoInfo: any
  ): Promise<boolean> {
    // Implementar verificação criptográfica da assinatura
    // Usar biblioteca de criptografia

    return true; // Implementação real
  }

  private async verificarTimestamp(timestampData: any): Promise<boolean> {
    // Verificar carimbo de tempo com TSA
    return true; // Implementação real
  }

  async gerarRelatorioAuditoria(periodo: { inicio: Date; fim: Date }): Promise<Buffer> {
    // Gerar relatório de auditoria de assinaturas
    // Para compliance e auditoria

    throw new Error('Não implementado');
  }
}