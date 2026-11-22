import { useEffect, useRef, useState } from 'react';

export function TableCamera({ onCapture }: { onCapture: (image: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true; let stream: MediaStream | undefined;
    void (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 } }, audio: false });
        if (!alive) { media.getTracks().forEach(t => t.stop()); return; }
        stream = media;
        if (video.current) { video.current.srcObject = media; await video.current.play(); }
      } catch { if (alive) setError('تعذر فتح الكاميرا. اسمح باستخدامها من إعدادات المتصفح ثم حاول مجددًا، أو اطلب مساعدة الموظف.'); }
    })();
    return () => { alive = false; stream?.getTracks().forEach(t => t.stop()); };
  }, []);
  function capture() {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight) return;
    const scale = Math.min(1, 640 / Math.max(source.videoWidth, source.videoHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(source.videoWidth * scale); canvas.height = Math.round(source.videoHeight * scale);
    const context = canvas.getContext('2d'); if (!context) return;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', 0.68);
    if (image.length > 180000) { setError('اقترب من رقم الطاولة وحاول التقاط الصورة مرة أخرى.'); return; }
    onCapture(image);
  }
  return <div className="customer-camera"><video ref={video} playsInline muted onLoadedData={() => setReady(true)} aria-label="كاميرا رقم الطاولة" />{error && <p role="alert" className="customer-alert">{error}</p>}<button type="button" className="customer-primary" disabled={!ready} onClick={capture}>تصوير رقم الطاولة</button></div>;
}

