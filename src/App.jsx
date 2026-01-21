import { useEffect, useMemo, useState } from 'react'
import './App.css'

// Catálogo inicial das APIs. Substitua pelos serviços reais que você quer comparar.
const presetApis = [
  {
    id: 'payments',
    label: 'Pagamentos · Gateway A',
    complexity: 'Baixa',
    description: 'Checkout direto com token Bearer simples e suporte a idempotência.',
    method: 'POST', // <== Informe o método HTTP aceito pela API
    baseUrl: 'https://sandbox.gatewaya.com', // <== Troque pelo host/base de produção ou sandbox
    path: '/v1/payments', // <== Endpoint que deseja testar
    headers: {
      Authorization: 'Bearer {{TOKEN_GATEWAY_A}}', // <== Coloque o header de autenticação/token
      'Content-Type': 'application/json',
      'X-Idempotency-Key': 'ORDER-123', // <== Inclua aqui headers obrigatórios adicionais
    },
    query: {
      expand: 'customer', // <== Adicione os query params que ajudam no debug
    },
    body: {
      amount: 1000,
      currency: 'BRL',
      payment_method: 'card',
      capture: true,
      metadata: {
        orderId: 'ORDER-123',
      },
    }, // <== Estruture o payload mínimo, ajustando ao contrato da API
    checklist: [
      'Gerar token Bearer no painel e enviá-lo em Authorization.',
      'Enviar X-Idempotency-Key para prevenir cobranças duplicadas.',
      'Erros retornam campos `errors[].message` e `errors[].code`.',
    ],
  },
  {
    id: 'loans',
    label: 'Crédito · API B',
    complexity: 'Média',
    description: 'Simulações exigem API Key própria e versionamento explícito na rota.',
    method: 'GET',
    baseUrl: 'https://api.banco-b.com', // <== Ajuste para o domínio oficial da API
    path: '/v2/loans/simulations', // <== Caminho/versão da simulação
    headers: {
      'x-api-key': '{{API_KEY_B}}', // <== Header onde colocar a sua API Key
      Accept: 'application/json',
    },
    query: {
      customerId: '12345678900', // <== Identificador obrigatório (CPF, ID, etc.)
      includeOffers: true,
    },
    body: {}, // GET normalmente não precisa de body; deixe vazio caso não use
    checklist: [
      'A chave deve ser regenerada no portal e enviada em x-api-key.',
      'Versionamento acontece no path (ex.: /v2).',
      'Use includeOffers=true para receber payload completo e comparar SLAs.',
    ],
  },
  {
    id: 'kyc',
    label: 'Onboarding · API C',
    complexity: 'Alta',
    description: 'Fluxo OAuth2 com webhooks e anexos base64 para validação de identidade.',
    method: 'POST',
    baseUrl: 'https://kyc.partners.com', // <== Host da API de KYC
    path: '/v3/identity/checks', // <== Endpoint responsável pela criação dos checks
    headers: {
      Authorization: 'Bearer {{ACCESS_TOKEN_OAUTH2}}', // <== Token OAuth2 Client Credentials
      'Content-Type': 'application/json',
      'X-Webhook-Token': '{{WEBHOOK_SECRET}}', // <== Assinatura para validar webhooks
    },
    query: {
      async: true,
    },
    body: {
      applicant: {
        document: {
          type: 'CPF',
          number: '12345678900',
        },
        attachments: ['{{BASE64_FILE}}'],
      },
      webhookUrl: 'https://example.com/webhooks/kyc',
    },
    checklist: [
      'Troque Authorization pelo token emitido via OAuth2 Client Credentials.',
      'Envie anexos convertidos em base64 na chave attachments[].',
      'Configure webhookUrl apontando para o seu ambiente público.',
    ],
  },
]

const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const toClassName = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()

const buildFormState = (preset) => ({
  method: preset.method || 'GET',
  baseUrl: preset.baseUrl || '',
  path: preset.path || '/',
  headers: JSON.stringify(preset.headers ?? {}, null, 2),
  query: JSON.stringify(preset.query ?? {}, null, 2),
  body: JSON.stringify(preset.body ?? {}, null, 2),
})

function App() {
  const [selectedApiId, setSelectedApiId] = useState(presetApis[0].id)
  const [formState, setFormState] = useState(() => buildFormState(presetApis[0]))
  const [runResult, setRunResult] = useState(null)
  const [formError, setFormError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const selectedPreset = useMemo(
    () => presetApis.find((api) => api.id === selectedApiId) ?? presetApis[0],
    [selectedApiId],
  )

  useEffect(() => {
    setFormState(buildFormState(selectedPreset))
  }, [selectedPreset])

  const handleFieldChange = (field) => (event) => {
    const value = event.target.value
    setFormState((prev) => ({ ...prev, [field]: value }))
  }

  const resetToPreset = () => {
    setFormState(buildFormState(selectedPreset))
    setFormError('')
  }

  const parseJsonField = (value, label) => {
    if (!value.trim()) {
      return {}
    }

    try {
      return JSON.parse(value)
    } catch (error) {
      throw new Error(`Campo "${label}" não está em JSON válido (${error.message}).`)
    }
  }

  const normalizeHeaders = (headersObject) => {
    const normalized = {}
    Object.entries(headersObject).forEach(([key, value]) => {
      if (value === undefined || value === null) return
      normalized[key] = String(value)
    })
    return normalized
  }

  const handleBenchmark = async () => {
    setFormError('')

    let headersObject
    let queryObject
    let bodyObject

    try {
      headersObject = parseJsonField(formState.headers, 'Headers')
      queryObject = parseJsonField(formState.query, 'Query params')
      bodyObject = parseJsonField(formState.body, 'Body')
    } catch (error) {
      setFormError(error.message)
      return
    }

    if (!formState.baseUrl.trim() || !formState.path.trim()) {
      setFormError('Preencha Base URL e Endpoint antes de executar o teste.')
      return
    }

    let targetUrl
    try {
      const normalizedBase = formState.baseUrl.trim().replace(/\/$/, '')
      const normalizedPath = formState.path.trim().startsWith('/')
        ? formState.path.trim()
        : `/${formState.path.trim()}`
      targetUrl = new URL(`${normalizedBase}${normalizedPath}`)
      Object.entries(queryObject).forEach(([key, value]) => {
        if (value === undefined || value === null) return
        targetUrl.searchParams.set(key, String(value))
      })
    } catch (error) {
      setFormError(`URL inválida: ${error.message}`)
      return
    }

    const normalizedHeaders = normalizeHeaders(headersObject)
    const requestInit = {
      method: formState.method,
      headers: normalizedHeaders,
    }

    if (formState.method !== 'GET' && Object.keys(bodyObject).length > 0) {
      requestInit.body = JSON.stringify(bodyObject)
    }

    setIsLoading(true)
    const startedAt = performance.now()

    try {
      const response = await fetch(targetUrl.toString(), requestInit)
      const rawBody = await response.text()
      let previewBody = rawBody
      let parsedBody = null

      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody)
          previewBody = JSON.stringify(parsedBody, null, 2)
        } catch {
          previewBody = rawBody
        }
      }

      setRunResult({
        timestamp: new Date().toLocaleString('pt-BR'),
        url: targetUrl.toString(),
        durationMs: Math.round(performance.now() - startedAt),
        request: {
          method: formState.method,
          headers: normalizedHeaders,
          query: queryObject,
          body: requestInit.body ? bodyObject : null,
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          contentType: response.headers.get('content-type'),
          preview: previewBody,
        },
      })
    } catch (error) {
      setRunResult({
        timestamp: new Date().toLocaleString('pt-BR'),
        url: targetUrl.toString(),
        durationMs: Math.round(performance.now() - startedAt),
        request: {
          method: formState.method,
          headers: normalizedHeaders,
          query: queryObject,
          body: requestInit.body ? bodyObject : null,
        },
        error: error.message,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const lastLatency = runResult?.durationMs ? `${runResult.durationMs} ms` : '--'

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Benchmark Lab</p>
          <h1>Comparador de APIs</h1>
          <p className="hero-subtitle">
            Centralize os requests, capture o debug bruto e compare rapidamente quais integrações são
            mais simples ou complexas antes de codar de fato.
          </p>
        </div>

        <div className="hero-metrics">
          <div className="metric-card">
            <span>APIs mapeadas</span>
            <strong>{presetApis.length}</strong>
          </div>
          <div className="metric-card">
            <span>Último tempo de resposta</span>
            <strong>{lastLatency}</strong>
          </div>
          <div className="metric-card">
            <span>Último teste</span>
            <strong>{runResult?.timestamp ?? '--'}</strong>
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="panel sidebar">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Catálogo</p>
              <h2>APIs candidatas</h2>
            </div>
            <span className="badge neutral">{presetApis.length}</span>
          </div>
          <p className="panel-description">
            Selecione uma API para carregar presets de headers, query params e payload. Substitua os
            valores comentados pelo que for recebido dos provedores.
          </p>

          <ul className="api-list">
            {presetApis.map((api) => (
              <li key={api.id}>
                <button
                  type="button"
                  className={`api-card ${selectedApiId === api.id ? 'active' : ''}`}
                  onClick={() => setSelectedApiId(api.id)}
                >
                  <div className="api-card__header">
                    <span className="api-title">{api.label}</span>
                    <span className={`badge ${toClassName(api.complexity)}`}>{api.complexity}</span>
                  </div>
                  <p>{api.description}</p>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="content-stack">
          <div className="panel request-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Request builder</p>
                <h2>{selectedPreset.label}</h2>
              </div>
              <span className={`badge ${toClassName(selectedPreset.complexity)}`}>
                Complexidade {selectedPreset.complexity}
              </span>
            </div>

            <div className="form-grid">
              <label className="form-control">
                <span>Método</span>
                <select value={formState.method} onChange={handleFieldChange('method')}>
                  {httpMethods.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-control">
                <span>Base URL</span>
                <input
                  type="text"
                  value={formState.baseUrl}
                  onChange={handleFieldChange('baseUrl')}
                  placeholder="https://api.suaempresa.com"
                />
              </label>

              <label className="form-control">
                <span>Endpoint</span>
                <input
                  type="text"
                  value={formState.path}
                  onChange={handleFieldChange('path')}
                  placeholder="/v1/resource"
                />
              </label>

              <label className="form-control stretch">
                <span>Query params (JSON)</span>
                <textarea
                  rows="3"
                  value={formState.query}
                  onChange={handleFieldChange('query')}
                />
              </label>

              <label className="form-control stretch">
                <span>Headers (JSON)</span>
                <textarea
                  rows="3"
                  value={formState.headers}
                  onChange={handleFieldChange('headers')}
                />
              </label>

              <label className="form-control stretch">
                <span>Body (JSON)</span>
                <textarea
                  rows="6"
                  value={formState.body}
                  onChange={handleFieldChange('body')}
                  placeholder='{"campo":"valor"}'
                />
              </label>
            </div>

            {formError && <div className="callout error">{formError}</div>}

            <div className="action-bar">
              <button type="button" className="ghost" onClick={resetToPreset} disabled={isLoading}>
                Restaurar preset
              </button>
              <button type="button" className="primary" onClick={handleBenchmark} disabled={isLoading}>
                {isLoading ? 'Executando...' : 'Rodar benchmark'}
              </button>
            </div>
          </div>

          <div className="grid-two">
            <div className="panel checklist-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Checklist</p>
                  <h3>O que configurar para integrar</h3>
                </div>
              </div>
              <ul className="checklist">
                {selectedPreset.checklist.map((item, index) => (
                  <li key={index}>
                    <span>•</span>
                    <p>{item}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel debug-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Debug</p>
                  <h3>Resposta da API</h3>
                </div>
                {runResult?.response && (
                  <span className={`badge ${runResult.response.ok ? 'success' : 'danger'}`}>
                    {runResult.response.status} {runResult.response.statusText}
                  </span>
                )}
              </div>

              {runResult ? (
                <div className="debug-grid">
                  <div>
                    <h4>Request montado</h4>
                    <pre className="code-block">
                      {JSON.stringify(
                        {
                          url: runResult.url,
                          method: runResult.request.method,
                          headers: runResult.request.headers,
                          query: runResult.request.query,
                          body: runResult.request.body,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>

                  <div>
                    <h4>Resposta / erro</h4>
                    <pre className="code-block">
                      {runResult.error ? runResult.error : runResult.response?.preview ?? 'Sem corpo'}
                    </pre>
                  </div>

                  <div className="debug-meta">
                    <div>
                      <span>Latency</span>
                      <strong>{runResult.durationMs} ms</strong>
                    </div>
                    <div>
                      <span>Conteúdo</span>
                      <strong>{runResult.response?.contentType ?? '--'}</strong>
                    </div>
                    <div>
                      <span>Executado em</span>
                      <strong>{runResult.timestamp}</strong>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="panel-description">
                  Execute um benchmark para ver o payload completo, status HTTP e headers da resposta
                  aqui.
                </p>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
