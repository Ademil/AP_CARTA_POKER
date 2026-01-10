import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

// Configurações
export const options = {
  stages: [
    { duration: '2m', target: 100 },    // Ramp up to 100 users
    { duration: '5m', target: 100 },    // Stay at 100 users
    { duration: '2m', target: 200 },    // Ramp up to 200 users
    { duration: '5m', target: 200 },    // Stay at 200 users
    { duration: '2m', target: 100 },    // Ramp down to 100 users
    { duration: '5m', target: 100 },    // Stay at 100 users
    { duration: '2m', target: 0 },      // Ramp down to 0 users
  ],
  
  thresholds: {
    'http_req_duration': ['p(95)<2000'],  // 95% das requisições < 2s
    'http_req_failed': ['rate<0.01'],     // < 1% de falhas
    'checks': ['rate>0.99'],              // > 99% de checks passam
  },
  
  ext: {
    loadimpact: {
      projectID: 123456,
      name: 'SST System Load Test'
    }
  }
};

// Variáveis de ambiente
const BASE_URL = __ENV.BASE_URL || 'https://api.sst.com';
const API_KEY = __ENV.API_KEY;
const USER_EMAIL = __ENV.USER_EMAIL || 'test@loadtest.com';
const USER_PASSWORD = __ENV.USER_PASSWORD || 'test123';

// Métricas customizadas
const errorRate = new Rate('errors');
const requestDuration = new Trend('request_duration');
const activeUsers = new Counter('active_users');

// Headers comuns
const commonHeaders = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`,
  'User-Agent': 'k6-load-test/1.0'
};

// Cliente HTTP com configurações
const httpParams = {
  headers: commonHeaders,
  timeout: '30s'
};

// Funções utilitárias
function generateRandomLaudo() {
  const tiposAgente = ['ruido', 'calor', 'quimico', 'ergonomia', 'psicossocial'];
  const empresas = ['Empresa A', 'Empresa B', 'Empresa C', 'Empresa D'];
  
  return {
    empresa: empresas[Math.floor(Math.random() * empresas.length)],
    tipoAgente: tiposAgente[Math.floor(Math.random() * tiposAgente.length)],
    agenteDescricao: `Agente de teste ${Math.random().toString(36).substr(2, 5)}`,
    fonteGeradora: `Fonte ${Math.random().toString(36).substr(2, 5)}`,
    nivelExposicao: Math.random() * 100,
    limiteTolerancia: 85,
    trabalhadoresExpostos: Math.floor(Math.random() * 10) + 1,
    conclusao: 'Conclusão de teste de carga',
    medidasControle: 'Medidas de controle de teste',
    dataAvaliacao: new Date().toISOString(),
    latitude: -23.550520 + (Math.random() - 0.5) * 0.1,
    longitude: -46.633308 + (Math.random() - 0.5) * 0.1
  };
}

function generateRandomUser() {
  const firstNames = ['João', 'Maria', 'Pedro', 'Ana', 'Carlos', 'Julia'];
  const lastNames = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues'];
  
  const randomId = Math.random().toString(36).substr(2, 8);
  
  return {
    nome: `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`,
    email: `user${randomId}@loadtest.com`,
    password: `Test@${randomId}`,
    role: 'engenheiro',
    crea: `CREA/SP ${Math.floor(Math.random() * 100000)}-D`
  };
}

// Cenários de teste
export function setup() {
  console.log('Setup: Iniciando configuração do teste...');
  
  // Login para obter token
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: USER_EMAIL,
    password: USER_PASSWORD
  }), httpParams);
  
  check(loginRes, {
    'login successful': (r) => r.status === 200,
    'token received': (r) => r.json('tokens.accessToken') !== undefined
  });
  
  const token = loginRes.json('tokens.accessToken');
  commonHeaders.Authorization = `Bearer ${token}`;
  
  console.log(`Setup: Token obtido, base URL: ${BASE_URL}`);
  
  return { token };
}

export default function (data) {
  activeUsers.add(1);
  
  // Grupo: Autenticação
  group('Authentication', () => {
    const meRes = http.get(`${BASE_URL}/api/auth/me`, httpParams);
    
    check(meRes, {
      'get user info status 200': (r) => r.status === 200,
      'user info valid': (r) => r.json('id') !== undefined
    });
    
    errorRate.add(meRes.status !== 200);
    requestDuration.add(meRes.timings.duration);
    
    sleep(1);
  });
  
  // Grupo: Laudos - CRUD
  group('Laudos CRUD', () => {
    // Criar laudo
    const createPayload = generateRandomLaudo();
    const createRes = http.post(`${BASE_URL}/api/laudos`, JSON.stringify(createPayload), httpParams);
    
    check(createRes, {
      'create laudo status 201': (r) => r.status === 201,
      'laudo created with id': (r) => r.json('id') !== undefined
    });
    
    const laudoId = createRes.json('id');
    
    // Buscar laudo
    if (laudoId) {
      const getRes = http.get(`${BASE_URL}/api/laudos/${laudoId}`, httpParams);
      
      check(getRes, {
        'get laudo status 200': (r) => r.status === 200,
        'laudo data matches': (r) => r.json('empresa') === createPayload.empresa
      });
      
      // Atualizar laudo
      const updateRes = http.put(`${BASE_URL}/api/laudos/${laudoId}`, JSON.stringify({
        ...createPayload,
        conclusao: 'Conclusão atualizada via load test'
      }), httpParams);
      
      check(updateRes, {
        'update laudo status 200': (r) => r.status === 200
      });
      
      // Listar laudos
      const listRes = http.get(`${BASE_URL}/api/laudos?limit=10&page=1`, httpParams);
      
      check(listRes, {
        'list laudos status 200': (r) => r.status === 200,
        'has laudos array': (r) => Array.isArray(r.json('data'))
      });
      
      // Upload de foto (simulado)
      const photoRes = http.post(`${BASE_URL}/api/laudos/${laudoId}/fotos`, null, {
        ...httpParams,
        headers: {
          ...httpParams.headers,
          'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW'
        }
      });
      
      check(photoRes, {
        'upload photo status 201': (r) => r.status === 201
      });
      
      // Assinar laudo (simulado)
      const signRes = http.post(`${BASE_URL}/api/laudos/${laudoId}/assinar`, JSON.stringify({
        certificado: 'test-certificate',
        senha: 'test123'
      }), httpParams);
      
      check(signRes, {
        'sign laudo status 200': (r) => r.status === 200
      });
    }
    
    sleep(2);
  });
  
  // Grupo: Consulta de Normas
  group('Normas API', () => {
    const normasRes = http.get(`${BASE_URL}/api/normas/atualizadas`, httpParams);
    
    check(normasRes, {
      'normas status 200': (r) => r.status === 200,
      'has normas array': (r) => Array.isArray(r.json())
    });
    
    // Consultar norma específica
    const normaRes = http.get(`${BASE_URL}/api/normas/NR-15`, httpParams);
    
    check(normaRes, {
      'norma NR-15 status 200': (r) => r.status === 200,
      'has norma data': (r) => r.json('codigo') === 'NR-15'
    });
    
    // Verificar conformidade
    const complianceRes = http.post(`${BASE_URL}/api/normas/verificar-conformidade`, JSON.stringify({
      tipoAgente: 'ruido',
      nivelExposicao: 90,
      limiteTolerancia: 85
    }), httpParams);
    
    check(complianceRes, {
      'compliance check status 200': (r) => r.status === 200,
      'has compliance result': (r) => r.json('conforme') !== undefined
    });
    
    sleep(1);
  });
  
  // Grupo: Dashboard e Relatórios
  group('Dashboard', () => {
    const statsRes = http.get(`${BASE_URL}/api/dashboard/stats`, httpParams);
    
    check(statsRes, {
      'dashboard stats status 200': (r) => r.status === 200,
      'has stats data': (r) => r.json('totalLaudos') !== undefined
    });
    
    const chartsRes = http.get(`${BASE_URL}/api/dashboard/charts`, httpParams);
    
    check(chartsRes, {
      'dashboard charts status 200': (r) => r.status === 200,
      'has charts data': (r) => r.json('riskDistribution') !== undefined
    });
    
    // Exportar relatório
    const exportRes = http.get(`${BASE_URL}/api/dashboard/export?format=pdf&period=month`, httpParams);
    
    check(exportRes, {
      'export report status 200': (r) => r.status === 200,
      'has pdf content': (r) => r.headers['Content-Type'] === 'application/pdf'
    });
    
    sleep(1);
  });
  
  // Grupo: Mapa de Riscos
  group('Mapas', () => {
    const mapRes = http.get(`${BASE_URL}/api/mapas/riscos?bounds=-23.6,-46.7,-23.4,-46.5`, httpParams);
    
    check(mapRes, {
      'map risks status 200': (r) => r.status === 200,
      'has risks data': (r) => Array.isArray(r.json('riscos'))
    });
    
    // Adicionar ponto de risco
    const addPointRes = http.post(`${BASE_URL}/api/mapas/pontos`, JSON.stringify({
      latitude: -23.550520 + (Math.random() - 0.5) * 0.01,
      longitude: -46.633308 + (Math.random() - 0.5) * 0.01,
      tipo: 'ruido',
      descricao: 'Ponto de teste de carga',
      nivelRisco: 'alto'
    }), httpParams);
    
    check(addPointRes, {
      'add risk point status 201': (r) => r.status === 201
    });
    
    sleep(1);
  });
  
  // Grupo: Usuários (apenas para admin)
  group('Users Management', () => {
    // Listar usuários
    const usersRes = http.get(`${BASE_URL}/api/users?limit=5`, httpParams);
    
    if (usersRes.status === 200) {
      check(usersRes, {
        'list users status 200': (r) => r.status === 200
      });
      
      // Criar usuário de teste
      const newUser = generateRandomUser();
      const createUserRes = http.post(`${BASE_URL}/api/users`, JSON.stringify(newUser), httpParams);
      
      check(createUserRes, {
        'create user status 201': (r) => r.status === 201
      });
    }
    
    sleep(1);
  });
  
  // Grupo: Sincronização
  group('Sync', () => {
    const syncRes = http.post(`${BASE_URL}/api/sync/execute`, JSON.stringify({
      providers: ['s3', 'google-drive']
    }), httpParams);
    
    check(syncRes, {
      'sync execute status 200': (r) => r.status === 200,
      'sync started': (r) => r.json('jobId') !== undefined
    });
    
    // Status da sincronização
    const statusRes = http.get(`${BASE_URL}/api/sync/status`, httpParams);
    
    check(statusRes, {
      'sync status status 200': (r) => r.status === 200,
      'has sync data': (r) => r.json('lastSync') !== undefined
    });
    
    sleep(1);
  });
  
  activeUsers.add(-1);
}

export function teardown(data) {
  console.log('Teardown: Limpando recursos de teste...');
  
  // Limpar dados de teste se necessário
  const cleanupRes = http.post(`${BASE_URL}/api/test/cleanup`, null, httpParams);
  
  check(cleanupRes, {
    'cleanup successful': (r) => r.status === 200
  });
  
  console.log('Teardown: Concluído');
}

// Gerar relatório HTML
export function handleSummary(data) {
  return {
    "summary.html": htmlReport(data),
    "stdout": textSummary(data, { indent: " ", enableColors: true })
  };
}

// Testes de smoke (rápidos)
export function smokeTest() {
  const res = http.get(`${BASE_URL}/health`);
  
  check(res, {
    'health check status 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500
  });
}

// Testes de stress
export const stressOptions = {
  vus: 1000,
  duration: '10m',
  
  thresholds: {
    http_req_duration: ['p(99)<5000'],
    http_req_failed: ['rate<0.05']
  }
};

// Testes de pico (spike)
export const spikeOptions = {
  stages: [
    { duration: '10s', target: 1000 },
    { duration: '1m', target: 1000 },
    { duration: '10s', target: 100 },
    { duration: '3m', target: 100 },
    { duration: '10s', target: 0 }
  ]
};