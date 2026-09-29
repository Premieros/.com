import type { BusinessProfileKey } from './businessProfiles';

export type BusinessFieldType = 'text' | 'number' | 'date' | 'boolean' | 'select';

export interface BusinessFieldDefinition {
  entity: 'product' | 'customer' | 'supplier';
  key: string;
  ar: string;
  en: string;
  type: BusinessFieldType;
  required?: boolean;
  options?: string[];
}

export interface BusinessRecordTypeDefinition {
  key: string;
  ar: string;
  en: string;
  customerRequired?: boolean;
  supplierRequired?: boolean;
  amountEnabled?: boolean;
  dateRangeEnabled?: boolean;
}

export interface BusinessRuntimeProfile {
  fields: BusinessFieldDefinition[];
  records: BusinessRecordTypeDefinition[];
}

export const BUSINESS_RUNTIME_PROFILES: Record<BusinessProfileKey, BusinessRuntimeProfile> = {
  restaurant: {
    fields: [],
    records: [],
  },
  food_manufacturing: {
    fields: [
      { entity: 'product', key: 'brand', ar: 'العلامة التجارية', en: 'Brand', type: 'text' },
      { entity: 'product', key: 'pack_size', ar: 'حجم العبوة', en: 'Pack size', type: 'text' },
      { entity: 'product', key: 'production_line', ar: 'خط الإنتاج', en: 'Production line', type: 'text' },
    ],
    records: [
      { key: 'production_plan', ar: 'خطة إنتاج', en: 'Production plan', amountEnabled: true, dateRangeEnabled: true },
    ],
  },
  pharmacy: {
    fields: [
      { entity: 'product', key: 'active_ingredient', ar: 'المادة الفعالة', en: 'Active ingredient', type: 'text' },
      { entity: 'product', key: 'dosage_form', ar: 'الشكل الدوائي', en: 'Dosage form', type: 'text' },
      { entity: 'product', key: 'strength', ar: 'التركيز', en: 'Strength', type: 'text' },
      { entity: 'product', key: 'requires_prescription', ar: 'يتطلب روشتة', en: 'Requires prescription', type: 'boolean' },
      { entity: 'supplier', key: 'license_number', ar: 'رقم الترخيص', en: 'License number', type: 'text' },
    ],
    records: [],
  },
  car_showroom: {
    fields: [
      { entity: 'product', key: 'vin', ar: 'رقم الشاسيه VIN', en: 'VIN', type: 'text', required: true },
      { entity: 'product', key: 'vehicle_model', ar: 'الموديل', en: 'Model', type: 'text', required: true },
      { entity: 'product', key: 'vehicle_year', ar: 'سنة الصنع', en: 'Year', type: 'number' },
      { entity: 'product', key: 'vehicle_color', ar: 'اللون', en: 'Color', type: 'text' },
      { entity: 'product', key: 'engine_number', ar: 'رقم الموتور', en: 'Engine number', type: 'text' },
      { entity: 'product', key: 'mileage', ar: 'عداد الكيلومترات', en: 'Mileage', type: 'number' },
      { entity: 'customer', key: 'national_id', ar: 'الرقم القومي', en: 'National ID', type: 'text' },
    ],
    records: [
      { key: 'vehicle_reservation', ar: 'حجز سيارة', en: 'Vehicle reservation', customerRequired: true, amountEnabled: true, dateRangeEnabled: true },
      { key: 'vehicle_handover', ar: 'تسليم سيارة', en: 'Vehicle handover', customerRequired: true, dateRangeEnabled: true },
    ],
  },
  tourism: {
    fields: [
      { entity: 'product', key: 'destination', ar: 'الوجهة', en: 'Destination', type: 'text', required: true },
      { entity: 'product', key: 'duration_days', ar: 'عدد الأيام', en: 'Duration days', type: 'number' },
      { entity: 'product', key: 'transport_type', ar: 'وسيلة النقل', en: 'Transport type', type: 'text' },
      { entity: 'customer', key: 'passport_number', ar: 'رقم جواز السفر', en: 'Passport number', type: 'text' },
      { entity: 'customer', key: 'passport_expiry', ar: 'انتهاء جواز السفر', en: 'Passport expiry', type: 'date' },
      { entity: 'customer', key: 'nationality', ar: 'الجنسية', en: 'Nationality', type: 'text' },
      { entity: 'supplier', key: 'service_type', ar: 'نوع مزود الخدمة', en: 'Service provider type', type: 'text' },
    ],
    records: [
      { key: 'booking', ar: 'حجز', en: 'Booking', customerRequired: true, supplierRequired: false, amountEnabled: true, dateRangeEnabled: true },
      { key: 'traveler', ar: 'بيانات مسافر', en: 'Traveler record', customerRequired: true, dateRangeEnabled: true },
      { key: 'supplier_booking', ar: 'حجز مورد خدمة', en: 'Supplier booking', supplierRequired: true, amountEnabled: true, dateRangeEnabled: true },
    ],
  },
  retail: {
    fields: [
      { entity: 'product', key: 'brand', ar: 'العلامة التجارية', en: 'Brand', type: 'text' },
      { entity: 'product', key: 'size', ar: 'المقاس', en: 'Size', type: 'text' },
      { entity: 'product', key: 'color', ar: 'اللون', en: 'Color', type: 'text' },
    ],
    records: [],
  },
  services: {
    fields: [
      { entity: 'product', key: 'service_duration_minutes', ar: 'مدة الخدمة بالدقائق', en: 'Service duration (minutes)', type: 'number' },
      { entity: 'product', key: 'service_category', ar: 'تصنيف الخدمة', en: 'Service category', type: 'text' },
    ],
    records: [
      { key: 'appointment', ar: 'موعد خدمة', en: 'Service appointment', customerRequired: true, amountEnabled: true, dateRangeEnabled: true },
    ],
  },
  custom: {
    fields: [],
    records: [],
  },
};
