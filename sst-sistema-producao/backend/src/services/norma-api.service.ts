import axios from 'axios';
import { config } from '../config';

export interface NormaRegulamentadora {
  codigo: string;
  titulo: string;
  descricao: string;
  versao: string;
  dataPublicacao: Date;
  dataVigencia: Date;
  status: 'vigente' | 'revogada' | 'alterada';
  arquivoUrl: string;
  alteracoes: string[];
  anexos: Array<{
    codigo: string;
    titulo: string;
    conteudo: string;
  }>;
}

export class NormaAPIService {
  private baseURL = config.GOV_BR_API_URL;
  private apiKey = config.GOV_BR_API_KEY;

  async buscarNormasAtualizadas(): Promise<NormaRegulamentadora[]> {
    try {
      const response = await axios.get(`${this.baseURL}/normas/atualizadas`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        },
        params: {
          tipo: 'NR',
          status: 'vigente',
          dataInicio: this.getLastMonthDate()
        }
      });

      return this.parseNormasResponse(response.data);
    } catch (error) {
      console.error('Erro ao buscar normas:', error);
      
      // Fallback para dados simulados se a API falhar
      return this.getSimulatedNormas();
    }
  }

  async buscarNormaPorCodigo(codigo: string): Promise<NormaRegulamentadora | null> {
    try {
      const response = await axios.get(`${this.baseURL}/normas/${codigo}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });

      return this.parseNormaResponse(response.data);
    } catch (error) {
      console.error(`Erro ao buscar norma ${codigo}:`, error);
      return this.getSimulatedNorma(codigo);
    }
  }

  async verificarConformidadeLaudo(laudoData: any): Promise<{
    conforme: boolean;
    normasAplicaveis: string[];
    inconformidades: Array<{
      norma: string;
      item: string;
      descricao: string;
      severidade: 'alta' | 'media' | 'baixa';
    }>;
  }> {
    const normas = await this.buscarNormasAtualizadas();
    const normasAplicaveis = this.identificarNormasAplicaveis(laudoData, normas);
    
    const inconformidades = this.verificarInconformidades(laudoData, normasAplicaveis);

    return {
      conforme: inconformidades.length === 0,
      normasAplicaveis: normasAplicaveis.map(n => n.codigo),
      inconformidades
    };
  }

  private identificarNormasAplicaveis(laudoData: any, normas: NormaRegulamentadora[]): NormaRegulamentadora[] {
    const aplicaveis: NormaRegulamentadora[] = [];

    // NR-01 - Disposições Gerais (sempre aplicável)
    aplicaveis.push(normas.find(n => n.codigo === 'NR-01')!);

    // NR-07 - PCMSO
    if (laudoData.tipoAgente !== 'ergonomia' && laudoData.tipoAgente !== 'psicossocial') {
      aplicaveis.push(normas.find(n => n.codigo === 'NR-07')!);
    }

    // NR-09 - PPRA/PGR
    aplicaveis.push(normas.find(n => n.codigo === 'NR-09')!);

    // NR-15 - Atividades Insalubres
    if (this.isAgenteInsalubre(laudoData.tipoAgente)) {
      aplicaveis.push(normas.find(n => n.codigo === 'NR-15')!);
    }

    // NR-17 - Ergonomia
    if (laudoData.tipoAgente === 'ergonomia') {
      aplicaveis.push(normas.find(n => n.codigo === 'NR-17')!);
    }

    return aplicaveis.filter(n => n !== undefined);
  }

  private verificarInconformidades(laudoData: any, normas: NormaRegulamentadora[]): any[] {
    const inconformidades: any[] = [];

    normas.forEach(norma => {
      switch (norma.codigo) {
        case 'NR-01':
          // Verificar gerenciamento de riscos
          if (!laudoData.medidasControle || laudoData.medidasControle.trim() === '') {
            inconformidades.push({
              norma: 'NR-01',
              item: '4.1',
              descricao: 'Ausência de medidas de controle no PGR',
              severidade: 'alta'
            });
          }
          break;

        case 'NR-15':
          // Verificar limites de tolerância
          if (laudoData.nivelExposicao && laudoData.limiteTolerancia) {
            if (laudoData.nivelExposicao > laudoData.limiteTolerancia) {
              inconformidades.push({
                norma: 'NR-15',
                item: 'Limite de tolerância',
                descricao: `Nível de exposição (${laudoData.nivelExposicao}) excede limite de tolerância (${laudoData.limiteTolerancia})`,
                severidade: 'alta'
              });
            }
          }
          break;
      }
    });

    return inconformidades;
  }

  private isAgenteInsalubre(tipoAgente: string): boolean {
    const agentesInsalubres = [
      'ruido', 'calor', 'frio', 'umidade', 'vibracao',
      'radiacao_ionizante', 'poeira_mineral', 'fumos_metalicos',
      'gases_vapores', 'produtos_quimicos', 'agentes_biologicos'
    ];
    return agentesInsalubres.includes(tipoAgente);
  }

  private getLastMonthDate(): string {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().split('T')[0];
  }

  private parseNormasResponse(data: any): NormaRegulamentadora[] {
    // Implementar parser da resposta da API
    return data.normas || [];
  }

  private parseNormaResponse(data: any): NormaRegulamentadora {
    // Implementar parser da norma específica
    return data.norma;
  }

  private getSimulatedNormas(): NormaRegulamentadora[] {
    // Dados simulados para desenvolvimento
    return [
      {
        codigo: 'NR-01',
        titulo: 'Disposições Gerais e Gerenciamento de Riscos Ocupacionais',
        descricao: 'Estabelece as disposições gerais e o gerenciamento de riscos ocupacionais',
        versao: '2023',
        dataPublicacao: new Date('2023-03-09'),
        dataVigencia: new Date('2023-03-09'),
        status: 'vigente',
        arquivoUrl: 'https://www.gov.br/normas/nr-01.pdf',
        alteracoes: ['Portaria SEPRT nº 6.730/2023'],
        anexos: []
      },
      // ... outras normas
    ];
  }

  private getSimulatedNorma(codigo: string): NormaRegulamentadora | null {
    const normas = this.getSimulatedNormas();
    return normas.find(n => n.codigo === codigo) || null;
  }

  async registrarConsultaNorma(usuarioId: string, normaCodigo: string): Promise<void> {
    // Registrar no banco de dados a consulta à norma
    // Para auditoria e estatísticas
    console.log(`Usuário ${usuarioId} consultou norma ${normaCodigo}`);
  }
}