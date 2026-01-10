import { google } from 'googleapis';
import { Client } from '@microsoft/microsoft-graph-client';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { config } from '../config';
import { Laudo } from '../database/entities/Laudo.entity';
import { Usuario } from '../database/entities/Usuario.entity';

export interface CloudFile {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface SyncResult {
  success: boolean;
  filesUploaded: number;
  filesDownloaded: number;
  errors: string[];
}

export class CloudSyncService {
  private s3Client: S3Client;
  private googleDrive: any;
  private oneDrive: any;

  constructor() {
    // Configurar AWS S3
    this.s3Client = new S3Client({
      region: config.S3_REGION,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY
      }
    });

    // Configurar Google Drive
    this.initializeGoogleDrive();
    
    // Configurar OneDrive
    this.initializeOneDrive();
  }

  private initializeGoogleDrive(): void {
    const oauth2Client = new google.auth.OAuth2(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      `${config.BASE_URL}/api/auth/google/callback`
    );

    this.googleDrive = google.drive({
      version: 'v3',
      auth: oauth2Client
    });
  }

  private initializeOneDrive(): void {
    this.oneDrive = Client.init({
      authProvider: (done) => {
        // Implementar autenticação Microsoft
        done(null, 'access-token');
      }
    });
  }

  async syncLaudo(laudo: Laudo, usuario: Usuario): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      filesUploaded: 0,
      filesDownloaded: 0,
      errors: []
    };

    try {
      // Sincronizar com todos os provedores configurados
      const providers = usuario.permissoes?.includes('sync:all') 
        ? ['s3', 'google-drive', 'onedrive']
        : ['s3'];

      for (const provider of providers) {
        try {
          switch (provider) {
            case 's3':
              await this.syncToS3(laudo);
              result.filesUploaded++;
              break;
            case 'google-drive':
              await this.syncToGoogleDrive(laudo, usuario);
              result.filesUploaded++;
              break;
            case 'onedrive':
              await this.syncToOneDrive(laudo, usuario);
              result.filesUploaded++;
              break;
          }
        } catch (error) {
          result.errors.push(`${provider}: ${error.message}`);
        }
      }

      result.success = result.errors.length === 0;
      return result;
    } catch (error) {
      result.errors.push(`Erro geral: ${error.message}`);
      return result;
    }
  }

  private async syncToS3(laudo: Laudo): Promise<void> {
    const folderPath = `laudos/${laudo.empresaId}/${laudo.id}`;
    
    // Upload do PDF
    if (laudo.documentoPdfUrl) {
      const pdfKey = `${folderPath}/laudo-${laudo.numero}.pdf`;
      await this.uploadToS3(pdfKey, laudo.documentoPdfUrl);
    }

    // Upload do Word
    if (laudo.documentoWordUrl) {
      const wordKey = `${folderPath}/laudo-${laudo.numero}.docx`;
      await this.uploadToS3(wordKey, laudo.documentoWordUrl);
    }

    // Upload das fotos
    for (const foto of laudo.fotos || []) {
      const fotoKey = `${folderPath}/fotos/${foto.id}.${foto.getExtension()}`;
      await this.uploadToS3(fotoKey, foto.url);
    }
  }

  private async uploadToS3(key: string, fileUrl: string): Promise<void> {
    // Implementar upload real para S3
    const command = new PutObjectCommand({
      Bucket: config.S3_BUCKET_NAME,
      Key: key,
      Body: await this.fetchFile(fileUrl),
      ContentType: this.getMimeType(key),
      Metadata: {
        uploadedAt: new Date().toISOString()
      }
    });

    await this.s3Client.send(command);
  }

  private async syncToGoogleDrive(laudo: Laudo, usuario: Usuario): Promise<void> {
    // Obter token de acesso do usuário
    const accessToken = await this.getUserGoogleToken(usuario.id);
    
    // Configurar autenticação
    this.googleDrive.auth.setCredentials({ access_token: accessToken });

    // Criar pasta da empresa se não existir
    const empresaFolderId = await this.findOrCreateFolder(
      `SST - ${laudo.empresa.razaoSocial}`,
      'root'
    );

    // Criar pasta do laudo
    const laudoFolderId = await this.findOrCreateFolder(
      `Laudo ${laudo.numero} - ${laudo.agenteDescricao}`,
      empresaFolderId
    );

    // Upload dos arquivos
    // ... implementação específica do Google Drive API
  }

  private async findOrCreateFolder(name: string, parentId: string): Promise<string> {
    // Buscar pasta existente
    const res = await this.googleDrive.files.list({
      q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id;
    }

    // Criar nova pasta
    const folderMetadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    };

    const folder = await this.googleDrive.files.create({
      resource: folderMetadata,
      fields: 'id'
    });

    return folder.data.id;
  }

  private async getUserGoogleToken(userId: string): Promise<string> {
    // Buscar token do banco de dados ou cache
    // Implementação específica
    return 'user-google-token';
  }

  private async fetchFile(url: string): Promise<Buffer> {
    // Implementar download de arquivo
    const response = await fetch(url);
    return Buffer.from(await response.arrayBuffer());
  }

  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'pdf': 'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'txt': 'text/plain'
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  async getSyncStatus(userId: string): Promise<any> {
    // Verificar status de sincronização com todos os provedores
    const status = {
      s3: await this.checkS3Status(),
      googleDrive: await this.checkGoogleDriveStatus(userId),
      oneDrive: await this.checkOneDriveStatus(userId),
      lastSync: new Date().toISOString()
    };

    return status;
  }

  private async checkS3Status(): Promise<boolean> {
    try {
      // Tentar listar buckets para verificar conexão
      await this.s3Client.send(new GetObjectCommand({
        Bucket: config.S3_BUCKET_NAME,
        Key: 'test-connection.txt'
      }));
      return true;
    } catch {
      return false;
    }
  }
}