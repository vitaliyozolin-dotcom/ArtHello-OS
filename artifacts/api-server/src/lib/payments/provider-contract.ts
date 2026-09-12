export type PaymentMethod = "card" | "sbp";
export type FiscalPaymentMethod = "full_payment" | "full_prepayment";
export type FiscalPaymentObject = "service" | "work" | "goods";

export interface FiscalReceiptItem {
  name: string;
  unitAmountKopecks: number;
  quantity: number;
  vatType: string;
  paymentMethod: FiscalPaymentMethod;
  paymentObject: FiscalPaymentObject;
  measure?: string;
}

export interface FiscalProfileSnapshot {
  taxSystemCode: string;
  items: readonly FiscalReceiptItem[];
}

export interface PaymentCustomerSnapshot {
  displayName?: string;
  email?: string;
  phone?: string;
}

export interface CreateFiscalizedPaymentInput {
  paymentLinkId: string;
  amountKopecks: number;
  purpose: string;
  providerCustomerCode: string;
  merchantId: string;
  customer: PaymentCustomerSnapshot;
  fiscal: FiscalProfileSnapshot;
  paymentMethods: readonly PaymentMethod[];
  successRedirectUrl: string;
  failRedirectUrl: string;
  ttlMinutes: number;
}

export interface CreatedProviderPayment {
  provider: "tochka";
  operationId: string;
  paymentLinkId: string;
  paymentUrl: string;
  status: string;
  rawReceiptStatus?: string | null;
}

export interface PaymentProvider {
  readonly provider: "tochka";
  createFiscalizedPayment(
    input: CreateFiscalizedPaymentInput,
  ): Promise<CreatedProviderPayment>;
}

export interface AcquiringPaymentEvent {
  provider: "tochka";
  eventId: string;
  paymentLinkId: string;
  operationId: string;
  status: "AUTHORIZED" | "APPROVED" | "DECLINED" | "UNKNOWN";
  amountKopecks: number;
  paidAt?: string | null;
  merchantId?: string | null;
  paymentMethod?: string | null;
}
