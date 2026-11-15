import { describe, expect, it } from 'vitest';
import { REPORT_REGISTRY } from '../../src/features/reporting/reportRegistry';
import {
  CONSUMPTION_REPORT_TYPES,
  CONSUMPTION_REPORT_LABELS,
  isConsumptionReportType,
} from '../../src/features/reporting/consumptionWorkspace';

describe('consumption workspace integration', () => {
  it('only uses registered, permission-gated Premier reports', () => {
    for (const type of CONSUMPTION_REPORT_TYPES) {
      const report = REPORT_REGISTRY.find(item => item.key === type);
      expect(report).toBeDefined();
      expect(report?.permissions).toContain('reports.view');
      expect(report?.permissions).toContain('reports.costing');
      expect(report?.category).toBe('manufacturing_costing');
    }
  });

  it('rejects unrecognized report types from the URL', () => {
    expect(isConsumptionReportType('component_consumption')).toBe(true);
    expect(isConsumptionReportType('raw_material_consumption')).toBe(true);
    expect(isConsumptionReportType('sales')).toBe(false);
    expect(isConsumptionReportType(null)).toBe(false);
  });

  it('has both-language descriptions and distinguishes financial movement from quantity ranking', () => {
    expect(CONSUMPTION_REPORT_LABELS.component_consumption.ar).toContain('استهلاك');
    expect(CONSUMPTION_REPORT_LABELS.raw_material_consumption.noteEn).toContain('movements');
    expect(CONSUMPTION_REPORT_LABELS.top_consumed_components.noteEn).toContain('quantities');
  });
});
