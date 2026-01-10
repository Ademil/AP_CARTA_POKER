import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

class ApiClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    this.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('access_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            const refreshToken = localStorage.getItem('refresh_token');
            if (!refreshToken) {
              throw new Error('No refresh token');
            }

            const response = await this.refreshAccessToken(refreshToken);
            const { token, refreshToken: newRefreshToken } = response.data;

            localStorage.setItem('access_token', token);
            localStorage.setItem('refresh_token', newRefreshToken);

            originalRequest.headers.Authorization = `Bearer ${token}`;
            return this.client(originalRequest);
          } catch (refreshError) {
            // Limpar tokens e redirecionar para login
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('user');
            
            window.location.href = '/login';
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  private async refreshAccessToken(refreshToken: string): Promise<AxiosResponse> {
    return axios.post(`${this.baseURL}/auth/refresh`, { refreshToken });
  }

  // Métodos HTTP
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }

  async uploadFile(url: string, file: File, onProgress?: (progress: number) => void): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.client.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      }
    });

    return response.data;
  }

  // Métodos específicos do SST
  async login(email: string, password: string): Promise<{ user: any; tokens: any }> {
    const response = await this.post('/auth/login', { email, password });
    
    localStorage.setItem('access_token', response.tokens.accessToken);
    localStorage.setItem('refresh_token', response.tokens.refreshToken);
    localStorage.setItem('user', JSON.stringify(response.user));
    
    return response;
  }

  async loginGoogle(code: string): Promise<{ user: any; tokens: any }> {
    const response = await this.post('/auth/google', { code });
    
    localStorage.setItem('access_token', response.tokens.accessToken);
    localStorage.setItem('refresh_token', response.tokens.refreshToken);
    localStorage.setItem('user', JSON.stringify(response.user));
    
    return response;
  }

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem('refresh_token');
    await this.post('/auth/logout', { refreshToken });
    
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  }

  async getLaudos(params?: any): Promise<any[]> {
    return this.get('/laudos', { params });
  }

  async createLaudo(laudoData: any): Promise<any> {
    return this.post('/laudos', laudoData);
  }

  async uploadLaudoFoto(laudoId: string, file: File): Promise<any> {
    return this.uploadFile(`/laudos/${laudoId}/fotos`, file);
  }

  async assinarLaudo(laudoId: string, assinaturaData: any): Promise<any> {
    return this.post(`/laudos/${laudoId}/assinar`, assinaturaData);
  }

  async sincronizarLaudo(laudoId: string): Promise<any> {
    return this.post(`/laudos/${laudoId}/sincronizar`);
  }

  async getNormasAtualizadas(): Promise<any[]> {
    return this.get('/normas/atualizadas');
  }

  async verificarConformidade(laudoData: any): Promise<any> {
    return this.post('/normas/verificar-conformidade', laudoData);
  }

  async getDashboardStats(): Promise<any> {
    return this.get('/dashboard/stats');
  }

  async getMapaRiscos(): Promise<any> {
    return this.get('/mapas/riscos');
  }

  async backupDados(): Promise<any> {
    return this.post('/backups/executar');
  }
}

export const api = new ApiClient();