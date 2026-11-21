import { describe,expect,it } from 'vitest';
import { getPermanentBranchQrUrl } from '@/features/qr/permanentBranchQrUrl';

describe('permanent venue QR link',()=>{
  const token='a'.repeat(64);
  it('is stable across all admin/custom domains',()=>{
    expect(getPermanentBranchQrUrl(token))
      .toBe('https://premieros-sage.vercel.app/#/qr/'+token);
    expect(getPermanentBranchQrUrl(token)).toBe(getPermanentBranchQrUrl(token));
  });
  it('never accepts malformed or foreign URL tokens',()=>{
    for(const bad of ['','abc','A'.repeat(64),'../../admin','https://evil.example', 'a'.repeat(65)]){
      expect(()=>getPermanentBranchQrUrl(bad)).toThrow('QR_LINK_INVALID');
    }
  });
});
