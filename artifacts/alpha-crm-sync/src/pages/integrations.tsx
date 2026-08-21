import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetConnectors,
  useGetIntegrationStats,
  useGetGoogleSheetsStatus,
  useListGoogleSheets,
  usePreviewGoogleSheet,
  useImportGoogleSheet,
  useSubmitWebsiteLead,
  getGetConnectorsQueryKey,
  getGetIntegrationStatsQueryKey,
  getGetGoogleSheetsStatusQueryKey,
  getListGoogleSheetsQueryKey,
  type SourceConnector,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  CheckCircle, AlertCircle, Clock, Loader2, ExternalLink,
  RefreshCw, ChevronRight, Database, Globe, MessageCircle,
  Phone, FileSpreadsheet, Bot, Copy, Check,
} from 'lucide-react';

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'active')
    return <Badge className="bg-green-100 text-green-800 border-green-200 text-xs gap-1"><CheckCircle className="w-3 h-3" />Active</Badge>;
  if (status === 'error')
    return <Badge className="bg-red-100 text-red-800 border-red-200 text-xs gap-1"><AlertCircle className="w-3 h-3" />Error</Badge>;
  return <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs gap-1"><Clock className="w-3 h-3" />Not connected</Badge>;
}

// ─── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="ml-1 p-1 rounded hover:bg-muted transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
    </button>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function IntegrationStatsBar() {
  const { data } = useGetIntegrationStats({ query: { refetchInterval: 15000, queryKey: getGetIntegrationStatsQueryKey() } });
  if (!data) return null;
  const items = [
    { label: 'Raw events', value: data.rawEventsTotal },
    { label: 'Sheets leads', value: data.googleSheetsLeads },
    { label: 'Webhook leads', value: data.websiteWebhookLeads },
    { label: 'Unprocessed', value: data.unprocessedEvents },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {items.map((it) => (
        <div key={it.label} className="bg-muted/40 rounded-lg px-4 py-3">
          <div className="text-xl font-bold tabular-nums">{it.value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── AlphaCRM card ────────────────────────────────────────────────────────────

function AlphaCRMCard({ connector }: { connector?: SourceConnector }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-500" />
            <CardTitle className="text-base">AlphaCRM</CardTitle>
          </div>
          <StatusBadge status={connector?.status ?? 'active'} />
        </div>
        <p className="text-xs text-muted-foreground">Student & payment data via AlphaCRM API</p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="bg-muted/40 rounded p-2 text-xs font-mono break-all">
          {(connector?.config as Record<string, unknown>)?.domain as string ?? "Не настроен"}
        </div>
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>ENV: <code className="bg-muted rounded px-1">ALFACRM_EMAIL</code> <code className="bg-muted rounded px-1">ALFACRM_API_KEY</code></div>
          <div>Syncs: branches, students, payments, lessons</div>
        </div>
        <p className="text-xs text-muted-foreground italic">Configure via CRM Sync tab</p>
      </CardContent>
    </Card>
  );
}

// ─── Google Sheets wizard ─────────────────────────────────────────────────────

type GSStep = 'idle' | 'sheets' | 'preview' | 'mapping' | 'importing' | 'done';

const LEAD_FIELD_LABELS: Record<string, string> = {
  date: 'Дата',
  clientName: 'Имя клиента',
  phone: 'Телефон',
  source: 'Источник',
  channel: 'Канал',
  campaign: 'Кампания',
  status: 'Статус',
  manager: 'Менеджер',
  comment: 'Комментарий',
  branch: 'Филиал',
};

function GoogleSheetsCard({ connector }: { connector?: SourceConnector }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<GSStep>('idle');
  const [selectedSheet, setSelectedSheet] = useState('');
  const [headerRow, setHeaderRow] = useState('0');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [branchCrmId, setBranchCrmId] = useState('');
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } =
    useGetGoogleSheetsStatus({ query: { queryKey: getGetGoogleSheetsStatusQueryKey() } });

  const { data: sheets, isLoading: sheetsLoading } =
    useListGoogleSheets({ query: { enabled: step === 'sheets' || step === 'preview' || step === 'mapping', queryKey: getListGoogleSheetsQueryKey() } });

  const { data: preview, isLoading: previewLoading } =
    usePreviewGoogleSheet(
      { sheetName: selectedSheet, headerRow },
      { query: { enabled: !!selectedSheet && (step === 'preview' || step === 'mapping'), queryKey: ['gs-preview', selectedSheet, headerRow] } }
    );

  const importMutation = useImportGoogleSheet();

  const configured = status?.configured;

  const handleImport = async () => {
    setStep('importing');
    try {
      const result = await importMutation.mutateAsync({
        data: { sheetName: selectedSheet, headerRow: parseInt(headerRow, 10) || 0, mapping, branchCrmId },
      });
      setImportResult(result);
      setStep('done');
      queryClient.invalidateQueries({ queryKey: getGetIntegrationStatsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetConnectorsQueryKey() });
    } catch {
      setStep('mapping');
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
            <CardTitle className="text-base">Google Sheets Leads</CardTitle>
          </div>
          <StatusBadge status={connector?.status ?? 'inactive'} />
        </div>
        <p className="text-xs text-muted-foreground">Import lead rows from a Google Spreadsheet</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ENV status */}
        {statusLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Checking credentials…</div>
        ) : !configured ? (
          <div className="space-y-2">
            <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
              <p className="font-medium mb-1">ENV vars required:</p>
              <code className="block">GOOGLE_SERVICE_ACCOUNT_JSON</code>
              <code className="block">GOOGLE_SHEET_ID_PROMOTION</code>
              {status?.error && <p className="mt-1 text-amber-700">{status.error}</p>}
            </div>
            <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => refetchStatus()}>
              <RefreshCw className="w-3 h-3 mr-1" />Recheck credentials
            </Button>
          </div>
        ) : step === 'idle' ? (
          <div className="space-y-2">
            <div className="bg-green-50 border border-green-200 rounded p-2 text-xs text-green-800">
              <span className="font-medium">Connected:</span> {status.spreadsheetTitle ?? 'Spreadsheet ready'}
            </div>
            <Button size="sm" className="w-full text-xs" onClick={() => setStep('sheets')}>
              <ChevronRight className="w-3 h-3 mr-1" />Import leads from sheet
            </Button>
            <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => { setStep('done'); setImportResult(null); }}>
              View last import
            </Button>
          </div>
        ) : step === 'sheets' ? (
          <div className="space-y-2">
            <p className="text-xs font-medium">Select sheet:</p>
            {sheetsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Loading sheets…</div>
            ) : (
              <div className="space-y-1">
                {(sheets ?? []).map((s) => (
                  <button
                    key={s.title}
                    onClick={() => { setSelectedSheet(s.title); setStep('preview'); }}
                    className={`w-full text-left text-xs px-3 py-2 rounded border transition-colors ${selectedSheet === s.title ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'}`}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            )}
            <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => setStep('idle')}>← Back</Button>
          </div>
        ) : step === 'preview' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Preview: <span className="text-muted-foreground">{selectedSheet}</span></p>
              <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => setStep('sheets')}>← Back</Button>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">Header row:</label>
              <Input
                type="number" min={0} value={headerRow} onChange={(e) => setHeaderRow(e.target.value)}
                className="h-7 text-xs w-16"
              />
            </div>
            {previewLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Loading preview…</div>
            ) : preview ? (
              <div className="overflow-x-auto">
                <table className="text-xs w-full border-collapse">
                  <thead>
                    <tr>{preview.headers.slice(0, 6).map((h) => (
                      <th key={h} className="border px-2 py-1 bg-muted text-left font-medium truncate max-w-24">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>{preview.headers.slice(0, 6).map((h) => (
                        <td key={h} className="border px-2 py-1 truncate max-w-24">{String(r[h] ?? '')}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-1">{preview.totalRowsInSheet} total rows · showing first 5</p>
              </div>
            ) : null}
            <Button size="sm" className="w-full text-xs" onClick={() => setStep('mapping')} disabled={!preview}>
              Map columns →
            </Button>
          </div>
        ) : step === 'mapping' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Map columns</p>
              <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => setStep('preview')}>← Back</Button>
            </div>
            <div className="space-y-1.5">
              {Object.entries(LEAD_FIELD_LABELS).map(([field, label]) => (
                <div key={field} className="flex items-center gap-2">
                  <label className="text-xs w-28 text-muted-foreground shrink-0">{label}</label>
                  <select
                    className="flex-1 text-xs border rounded px-1.5 py-1 bg-background"
                    value={mapping[field] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                  >
                    <option value="">— skip —</option>
                    {(preview?.headers ?? []).map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <label className="text-xs w-28 text-muted-foreground shrink-0">Branch CRM ID</label>
                <Input
                  className="flex-1 h-7 text-xs"
                  placeholder="optional"
                  value={branchCrmId}
                  onChange={(e) => setBranchCrmId(e.target.value)}
                />
              </div>
            </div>
            <Button
              size="sm" className="w-full text-xs mt-2"
              disabled={!mapping.phone && !mapping.clientName}
              onClick={handleImport}
            >
              Import rows →
            </Button>
          </div>
        ) : step === 'importing' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />Importing rows…
          </div>
        ) : step === 'done' ? (
          <div className="space-y-2">
            {importResult ? (
              <div className="bg-green-50 border border-green-200 rounded p-2 text-xs text-green-800 space-y-0.5">
                <p className="font-medium">Import complete</p>
                <p>Imported: {importResult.imported} · Skipped: {importResult.skipped} · Total: {importResult.total}</p>
              </div>
            ) : null}
            <Button size="sm" className="w-full text-xs" onClick={() => { setStep('idle'); setImportResult(null); setMapping({}); }}>
              Import again
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Bank statements card ─────────────────────────────────────────────────────

function BankStatementsCard({ connector }: { connector?: SourceConnector }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-violet-500" />
            <CardTitle className="text-base">Bank Statements</CardTitle>
          </div>
          <StatusBadge status={connector?.status ?? 'inactive'} />
        </div>
        <p className="text-xs text-muted-foreground">Upload CSV / XLSX bank statements</p>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="bg-muted/40 rounded p-2 space-y-1 text-muted-foreground">
          <p>Supports: Сбербанк, Тинькофф, ВТБ, Альфа, generic CSV</p>
          <p>Every import tracked in <code className="bg-muted rounded px-1">bank_import_batches</code></p>
          <p>Auto-categorised via rules → flags unclear operations</p>
        </div>
        <p className="text-muted-foreground italic">Use the <strong className="text-foreground">Finance</strong> tab → Import to upload a statement</p>
      </CardContent>
    </Card>
  );
}

// ─── Website webhook card ─────────────────────────────────────────────────────

function WebsiteWebhookCard({ connector }: { connector?: SourceConnector }) {
  const [testResult, setTestResult] = useState<{ success: boolean; id?: string | null } | null>(null);
  const [testing, setTesting] = useState(false);
  const submitMutation = useSubmitWebsiteLead();

  const domain = window.location.origin;
  const endpoint = `${domain}/api/webhooks/website-lead`;

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await submitMutation.mutateAsync({
        data: { name: 'Test Lead', phone: '+79991234567', source: 'test', utm_campaign: 'webhook_test' },
      });
      setTestResult(result);
    } catch {
      setTestResult({ success: false });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-orange-500" />
            <CardTitle className="text-base">Website Forms</CardTitle>
          </div>
          <StatusBadge status={connector?.status ?? 'inactive'} />
        </div>
        <p className="text-xs text-muted-foreground">POST webhook — receives form submissions from the website</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-1 bg-muted/40 rounded px-2 py-1.5 font-mono text-xs break-all">
          <span className="text-muted-foreground mr-1">POST</span>
          <span className="flex-1 truncate">{endpoint}</span>
          <CopyButton text={endpoint} />
        </div>
        <div className="text-xs text-muted-foreground space-y-0.5">
          <p className="font-medium text-foreground">Fields accepted:</p>
          <p>name, phone, email, message, source, campaign, branch, form_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term</p>
        </div>
        <div className="text-xs bg-muted/40 rounded p-2 font-mono overflow-x-auto">
          {`fetch("${endpoint}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name, phone, utm_source, utm_campaign })
})`}
        </div>
        {testResult && (
          <div className={`text-xs rounded p-2 ${testResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {testResult.success ? `✓ Test lead saved (id: ${testResult.id?.slice(0, 8)}…)` : '✗ Test failed'}
          </div>
        )}
        <Button size="sm" variant="outline" className="w-full text-xs" onClick={handleTest} disabled={testing}>
          {testing ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Sending…</> : 'Send test lead'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Placeholder connector card ───────────────────────────────────────────────

interface PlaceholderCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  envVars: string[];
  futureEndpoint: string;
  dataFields: string[];
  connector?: SourceConnector;
}

function PlaceholderCard({ icon, title, description, envVars, futureEndpoint, dataFields, connector }: PlaceholderCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="opacity-80">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <StatusBadge status={connector?.status ?? 'inactive'} />
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {open ? '▾' : '▸'} Connector contract
        </button>
        {open && (
          <div className="text-xs space-y-2 bg-muted/30 rounded p-2">
            <div>
              <p className="font-medium mb-1">ENV vars required:</p>
              {envVars.map((e) => <code key={e} className="block text-muted-foreground">{e}</code>)}
            </div>
            <div>
              <p className="font-medium mb-1">Future endpoint:</p>
              <code className="text-muted-foreground">{futureEndpoint}</code>
            </div>
            <div>
              <p className="font-medium mb-1">Fields captured:</p>
              <p className="text-muted-foreground">{dataFields.join(', ')}</p>
            </div>
            <div>
              <p className="font-medium">Storage:</p>
              <p className="text-muted-foreground">raw_events → lead_events (channel = {title.toLowerCase().split(' ')[0]})</p>
            </div>
          </div>
        )}
        <Button size="sm" variant="outline" className="w-full text-xs" disabled>
          Coming soon
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Main Integrations page ───────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { data: connectors = [], isLoading } = useGetConnectors({
    query: { refetchInterval: 30000, queryKey: getGetConnectorsQueryKey() },
  });

  const byType = (type: string) => connectors.find((c) => c.sourceType === type);
  const byName = (name: string) => connectors.find((c) => c.sourceName.toLowerCase().includes(name.toLowerCase()));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />Loading connectors…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <IntegrationStatsBar />

      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Data Sources
        </h2>
        <p className="text-xs text-muted-foreground -mt-2 mb-4">
          All external data lands in <code className="bg-muted rounded px-1">raw_events</code> first, then normalises into <code className="bg-muted rounded px-1">lead_events</code> or <code className="bg-muted rounded px-1">bank_transactions</code>.
          Secrets are never stored in the database — only ENV references.
        </p>
      </div>

      {/* Connector grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <AlphaCRMCard connector={byType('crm')} />
        <GoogleSheetsCard connector={byType('google_sheet')} />
        <BankStatementsCard connector={byType('bank')} />
        <WebsiteWebhookCard connector={byType('website')} />

        <PlaceholderCard
          connector={byName('vk')}
          icon={<MessageCircle className="w-5 h-5 text-blue-400" />}
          title="VK Leads"
          description="Leads from VK lead forms and group messages"
          envVars={['VK_ACCESS_TOKEN', 'VK_GROUP_ID', 'VK_API_VERSION']}
          futureEndpoint="GET api.vk.com/method/leadForms.getLeads"
          dataFields={['lead_id', 'first_name', 'last_name', 'phone', 'ad_id', 'campaign_id', 'created_at']}
        />

        <PlaceholderCard
          connector={byName('telegram')}
          icon={<Bot className="w-5 h-5 text-sky-500" />}
          title="Telegram Bot"
          description="Leads and messages via Telegram bot webhook"
          envVars={['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET']}
          futureEndpoint="POST /api/webhooks/telegram"
          dataFields={['chat_id', 'first_name', 'last_name', 'phone', 'text', 'message_id']}
        />

        <PlaceholderCard
          connector={byName('whatsapp')}
          icon={<MessageCircle className="w-5 h-5 text-green-500" />}
          title="WhatsApp / WABA"
          description="Inbound messages via Meta Business / WABA webhook"
          envVars={['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN']}
          futureEndpoint="POST /api/webhooks/whatsapp"
          dataFields={['from', 'timestamp', 'type', 'text.body', 'message_id']}
        />

        <PlaceholderCard
          connector={byName('telephony')}
          icon={<Phone className="w-5 h-5 text-purple-500" />}
          title="IP Telephony"
          description="Call events: missed calls become leads automatically"
          envVars={['TELEPHONY_PROVIDER', 'TELEPHONY_API_KEY', 'TELEPHONY_API_SECRET', 'TELEPHONY_WEBHOOK_SECRET']}
          futureEndpoint="POST /api/webhooks/telephony"
          dataFields={['call_id', 'direction', 'caller_phone', 'start_time', 'duration_sec', 'disposition', 'operator_name']}
        />
      </div>

      {/* Docs link */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-4">
        <ExternalLink className="w-3.5 h-3.5" />
        Full connector contracts: <code className="bg-muted rounded px-1">docs/integration_contracts.md</code>
      </div>
    </div>
  );
}
