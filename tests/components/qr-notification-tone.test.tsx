import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQrNotificationTone } from '@/features/qr/useQrNotificationTone';
const audio={oscillators:vi.fn(),resume:vi.fn(),close:vi.fn()};
class FakeAudio {
 state='suspended';currentTime=0;destination={};
 async resume(){this.state='running';audio.resume();}
 async close(){this.state='closed';audio.close();}
 createOscillator(){audio.oscillators();return {type:'sine',frequency:{value:0},connect:vi.fn(),start:vi.fn(),stop:vi.fn(),disconnect:vi.fn(),onended:null};}
 createGain(){return {gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};}
}
function TestTone({count}:{count:number}){const tone=useQrNotificationTone(count,true);return <span>{tone.ready?'ready':'gesture needed'}</span>;}
describe('customer order notification audio',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('AudioContext',FakeAudio);audio.oscillators.mockClear();audio.resume.mockClear();audio.close.mockClear();});
 afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
 it('waits for a gesture, repeats while pending and stops after processing or unmount',async()=>{
  const view=render(<TestTone count={1}/>);expect(audio.oscillators).not.toHaveBeenCalled();
  await act(async()=>{fireEvent.pointerDown(window);});expect(screen.getByText('ready')).toBeInTheDocument();expect(audio.oscillators).toHaveBeenCalledTimes(2);
  act(()=>vi.advanceTimersByTime(10000));expect(audio.oscillators).toHaveBeenCalledTimes(4);
  view.rerender(<TestTone count={0}/>);act(()=>vi.advanceTimersByTime(20000));expect(audio.oscillators).toHaveBeenCalledTimes(4);
  view.unmount();expect(audio.close).toHaveBeenCalledTimes(1);
 });
});
