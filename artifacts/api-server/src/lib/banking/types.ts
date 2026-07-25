// ─── Tochka OAuth auth stage state machine ────────────────────────────────────

export type TochkaAuthStage =
  | 'not_configured'      // No clientId/clientSecret
  | 'service_token_ok'   // client_credentials OK, no consent yet
  | 'consent_pending'    // Consent created, awaiting user authorization
  | 'awaiting_callback'  // User redirected to Tochka, waiting for code
  | 'token_ok'           // Have hybrid access_token, API ready
  | 'token_expired'      // Hybrid token expired, needs refresh
  | 'error';             // Unrecoverable error

// ─── Connector config shapes (stored in bank_connectors.config jsonb) ─────────

export interface TochkaConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;        // registered redirect_uri (auto-derived if absent)
  customerCode?: string;       // passed as CustomerCode: header on every API request

  // Service token (client_credentials grant) — for consent creation only
  serviceToken?: string;
  serviceTokenExpiresAt?: string;

  // Consent
  consentId?: string;
  consentStatus?: string;      // 'AwaitingAuthorisation' | 'Authorised' | 'Rejected'
  consentCreatedAt?: string;

  // CSRF state for Authorization Code flow
  oauthState?: string;

  // Hybrid access token (authorization_code grant) — for /accounts, /balances, etc.
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;

  // Customer discovery (introspect sub → /customers fallback)
  customers?: TochkaCustomer[];
  resolvedCustomerCodeAt?: string;
  customerCodeSource?: 'introspect' | 'customers_api';
  introspectSub?: string;

  // Derived stage (kept in sync on every token write)
  authStage?: TochkaAuthStage;
}

export interface TinkoffConfig {
  apiKey?: string;
  terminalKey?: string;
}

export interface VtbConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

export type ConnectorConfig = TochkaConfig | TinkoffConfig | VtbConfig;

// ─── Connector status ─────────────────────────────────────────────────────────

export type ConnectorStatus =
  | 'active'
  | 'inactive'
  | 'connected_partial'  // accounts + balances OK; transactions not supported (e.g. 501)
  | 'error'
  | 'not_configured';

export type DiagnosticCode =
  | 'ok'
  | 'not_configured'
  | 'auth_failed'
  | 'token_expired'
  | 'scope_missing'
  | 'accounts_forbidden'
  | 'open_banking_not_activated'
  | 'sandbox_prod_mismatch'
  | 'redirect_uri_mismatch'
  | 'awaiting_user_authorization'
  | 'consent_not_created'
  | 'connector_inactive'
  | 'api_error'
  | 'rate_limited'
  | 'network_error';

// ─── Basic health (legacy) ────────────────────────────────────────────────────

export interface ConnectorHealth {
  status: ConnectorStatus;
  message?: string;
  checkedAt: string;
}

// ─── Detailed health with diagnostics ────────────────────────────────────────

export interface ConnectorHealthDetail {
  status: ConnectorStatus;
  message: string;
  checkedAt: string;

  // Auth
  authOk: boolean;
  tokenExpiresAt?: string | null;
  tokenExpired?: boolean;

  // OAuth stage
  authStage?: TochkaAuthStage;
  consentId?: string | null;
  consentStatus?: string | null;
  authorizeUrl?: string | null;

  // Scopes
  scopesGranted: string[];
  hasAccountsScope: boolean;
  hasTransactionsScope: boolean;

  // API access
  accountsAccessOk: boolean;
  transactionsAccessOk: boolean;
  accountCount?: number | null;

  // Environment
  environment: 'production' | 'sandbox' | 'unknown';
  apiBase: string;

  // Diagnostic
  diagnosticCode: DiagnosticCode;
  diagnosticMessage: string;

  // Customer resolution
  resolvedCustomerCode?: string | null;
  customersCount?: number | null;
  customers?: TochkaCustomer[];

  // Raw HTTP debug info
  debug?: {
    requestUrl?: string;
    responseStatus?: number;
    responseBody?: string;
    clientId?: string;
    tokenUrl?: string;
    tokenExists?: boolean;
    tokenLength?: number;
    tokenMasked?: string;
    tokenTypeOf?: string;
    sentHeaders?: string;
    accountsUrl?: string;
    customerCode?: string;
    resolvedCustomerCode?: string;
    sentCustomerHeader?: boolean;
    customersResponse?: string;
    introspectSub?: string;
    customerCodeSource?: string;
    // Stage-specific
    serviceTokenExists?: boolean;
    serviceTokenLength?: number;
    hybridTokenExists?: boolean;
    hybridTokenLength?: number;
  };
}

// ─── Tochka customer (company) ───────────────────────────────────────────────

export interface TochkaCustomer {
  customerCode: string;
  customerName: string;
  customerType?: string;    // e.g. "Business", "Individual"
  taxpayerNumber?: string;  // ИНН / taxCode
  raw: Record<string, unknown>;
}

// ─── OAuth flow result types ──────────────────────────────────────────────────

export interface TochkaOAuthStartResult {
  authorizeUrl: string;
  stage: TochkaAuthStage;
}

export interface TochkaOAuthStatusResult {
  stage: TochkaAuthStage;
  consentStatus: string | null;
  hasHybridToken: boolean;
  hybridTokenExpiresAt: string | null;
  message: string;
}

// ─── Normalized bank account ──────────────────────────────────────────────────

export interface NormalizedAccount {
  externalAccountId: string;
  accountName: string;
  accountNumber: string;
  accountStatus?: string;   // "Enabled" | "Disabled" | "Locked" — from bank API
  maskedAccount?: string;   // "****1234" — last 4 of accountNumber
  currency: string;
  currentBalance: number;
  availableBalance: number;
  raw: Record<string, unknown>;
}

// ─── Normalized statement ─────────────────────────────────────────────────────

export interface NormalizedStatement {
  externalStatementId: string;
  externalAccountId: string;
  periodFrom: string;    // YYYY-MM-DD
  periodTo: string;      // YYYY-MM-DD
  raw: Record<string, unknown>;
}

// ─── Normalized transaction ───────────────────────────────────────────────────

export interface NormalizedTransaction {
  externalTransactionId: string;
  accountId: string;            // external_account_id (e.g. "40702.../044525104")
  operationDate: string;        // YYYY-MM-DD
  amount: number;               // always positive; direction indicates sign
  currency: string;
  direction: 'income' | 'expense';
  counterpartyName: string | null;
  counterpartyInn: string | null;
  purpose: string | null;
  raw: Record<string, unknown>;
  // Extended fields (populated from statements API)
  maskedAccount?: string;
  bookingDateTime?: string;     // ISO 8601 timestamp
  valueDateTime?: string;       // ISO 8601 timestamp (settlement)
  counterpartyAccount?: string; // counterparty's account number
  operationType?: string;       // bank-specific operation type code
}

// ─── Sync result ──────────────────────────────────────────────────────────────

export interface SyncResult {
  transactionsReceived: number;
  transactionsNew: number;
  transactionsDuplicates: number;
  balancesUpdated: number;
  durationMs: number;
  errorsCount: number;
  errors: string[];
}

// ─── Interface every connector must implement ─────────────────────────────────

export interface BankConnectorInterface {
  bankName: string;
  authType: 'oauth' | 'api_key' | 'manual';

  isConfigured(): boolean;
  authenticate(): Promise<void>;
  refreshToken(): Promise<void>;
  getAccounts(): Promise<NormalizedAccount[]>;
  getBalances(accountIds: string[]): Promise<NormalizedAccount[]>;
  getTransactions(from: Date, to: Date, accountId?: string): Promise<NormalizedTransaction[]>;
  normalizeTransaction(raw: Record<string, unknown>): NormalizedTransaction;
  healthCheck(): Promise<ConnectorHealth>;
  healthCheckDetailed(): Promise<ConnectorHealthDetail>;
}
