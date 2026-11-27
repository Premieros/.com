import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  CheckCircle2, Clock, ChefHat, Truck, ShoppingBag, Utensils,
  ArrowRight, Phone, MapPin, RefreshCw, AlertCircle, PlusCircle,
} from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { Logo } from '@/components/Logo';
import type { Order, OrderItem } from '@/lib/types';

export function CustomerTrackPage() {
  const { orderId: paramOrderId } = useParams<{ orderId?: string }>();
  const navigate = useNavigate();
  const { lang, setLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const isAr = lang === 'ar';

  const activeId = paramOrderId || sessionStorage.getItem('premier_current_order_id');
  const [order, setOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pastOrders, setPastOrders] = useState<Order[]>([]);

  const currency = 'EGP';

  const loadOrder = async () => {
    if (!activeId) {
      setLoading(false);
      return;
    }
    try {
      const { data: o, error: oErr } = await supabase
        .from('orders')
        .select('*')
        .eq('id', activeId)
        .maybeSingle();

      if (oErr) throw oErr;
      if (o) {
        setOrder(o);
        const { data: items } = await supabase
          .from('order_items')
          .select('*, product:products(*)')
          .eq('order_id', o.id);
        if (items) setOrderItems(items);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading order tracking');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrder();
    const interval = setInterval(loadOrder, 10000); // Polling every 10s for real-time updates
    return () => clearInterval(interval);
  }, [activeId]);

  // Determine active step index: 0 = received, 1 = kitchen, 2 = ready/delivering, 3 = delivered/completed
  const getStepIndex = (ord: Order) => {
    if (ord.status === 'completed') return 3;
    if (ord.status === 'out_for_delivery') return 2;
    if (ord.status === 'ready') return 2;
    if (ord.status === 'preparing' || ord.status === 'in_preparation') return 1;
    return 0; // open / received
  };

  const currentStep = order ? getStepIndex(order) : 0;

  const steps = [
    {
      title: isAr ? 'استلام الطلب' : 'Order Received',
      desc: isAr ? 'تم استلام طلبك وجاري مراجعته' : 'Order received & queued',
      icon: <Clock className="h-5 w-5" />,
    },
    {
      title: isAr ? 'قيد التحضير في المطبخ' : 'Cooking in Kitchen',
      desc: isAr ? 'فريق المطبخ يجهز أصناف الوجبة بعناية' : 'Kitchen team is preparing your meal',
      icon: <ChefHat className="h-5 w-5" />,
    },
    {
      title: order?.order_type === 'delivery'
        ? (isAr ? 'في الطريق مع السائق' : 'Out for Delivery')
        : (isAr ? 'جاهز للاستلام / التقديم' : 'Ready for Pickup / Dine-in'),
      desc: order?.order_type === 'delivery'
        ? (isAr ? 'السائق في طريقه إلى عنوانك' : 'Driver is on the way to you')
        : (isAr ? 'وجبتك جاهزة وساخنة' : 'Your meal is ready'),
      icon: order?.order_type === 'delivery' ? <Truck className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />,
    },
    {
      title: isAr ? 'تم التسليم بنجاح' : 'Delivered & Completed',
      desc: isAr ? 'نتمنى لك تجربة طعام استثنائية' : 'Enjoy your meal!',
      icon: <CheckCircle2 className="h-5 w-5" />,
    },
  ];

  return (
    <div className="min-h-screen bg-ui-page text-ui-text pb-20">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-ui-border bg-ui-surface/95 backdrop-blur-md px-4 py-3 shadow-ui-xs">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo size={32} />
            <div>
              <p className="text-sm font-black tracking-tight text-ui-text">Premier Dining</p>
              <p className="text-[10px] font-bold text-ui-muted">{isAr ? 'متابعة الطلب الحي' : 'Live Order Tracking'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLang(isAr ? 'en' : 'ar')}
              className="rounded-lg border border-ui-border bg-ui-page-alt px-2.5 py-1 text-xs font-black text-ui-muted hover:text-ui-text transition"
            >
              {isAr ? 'English' : 'العربية'}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg border border-ui-border bg-ui-page-alt p-1.5 text-xs text-ui-muted hover:text-ui-text transition"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <Link
              to="/order"
              className="flex items-center gap-1.5 rounded-xl bg-ui-primary px-3 py-1.5 text-xs font-black text-ui-primary-fg shadow-ui-xs hover:bg-ui-primary-hover transition"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>{isAr ? 'طلب جديد' : 'New Order'}</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Track View */}
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {!activeId || (!loading && !order) ? (
          <div className="rounded-2xl border border-ui-border bg-ui-surface p-8 text-center space-y-4">
            <ShoppingBag className="h-12 w-12 mx-auto text-ui-muted opacity-40" />
            <h2 className="text-base font-black text-ui-text">{isAr ? 'لا يوجد طلب نشط حالياً للمتابعة' : 'No active order found to track'}</h2>
            <p className="text-xs text-ui-muted max-w-sm mx-auto">{isAr ? 'يمكنك تصفح المنيو وإرسال طلب جديد بنوع الصالة أو التوصيل أو السفري' : 'Browse our menu and place a new order'}</p>
            <Link
              to="/order"
              className="inline-flex items-center gap-2 rounded-xl bg-ui-primary px-4 py-2.5 text-xs font-black text-ui-primary-fg shadow-ui-sm hover:bg-ui-primary-hover"
            >
              <PlusCircle className="h-4 w-4" />
              <span>{isAr ? 'بدء طلب جديد' : 'Start New Order'}</span>
            </Link>
          </div>
        ) : (
          <>
            {/* Order Status Hero Card */}
            <div className="rounded-3xl border border-ui-border bg-ui-surface p-6 shadow-ui-sm space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border pb-4">
                <div>
                  <span className="text-xs font-bold text-ui-muted">{isAr ? 'رقم الطلب' : 'Order Number'}</span>
                  <h1 className="text-2xl font-black text-ui-accent tracking-tight">#{order.order_number}</h1>
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded-xl bg-ui-primary-soft px-3 py-1.5 text-xs font-black text-ui-accent">
                    {order.order_type === 'delivery'
                      ? (isAr ? '🛵 طلب توصيل' : '🛵 Delivery')
                      : order.order_type === 'takeaway'
                      ? (isAr ? '🛍️ طلب سفري' : '🛍️ Takeaway')
                      : (isAr ? '🍽️ طلب صالة' : '🍽️ Dine-in')}
                  </span>
                  <button
                    type="button"
                    onClick={loadOrder}
                    className="p-1.5 rounded-xl border border-ui-border bg-ui-page-alt text-ui-muted hover:text-ui-text transition"
                    title={isAr ? 'تحديث الحالة' : 'Refresh status'}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Progress Stepper */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {steps.map((st, i) => {
                  const isDone = i <= currentStep;
                  const isCurrent = i === currentStep;
                  return (
                    <div
                      key={i}
                      className={`rounded-2xl border p-4 transition ${
                        isCurrent
                          ? 'border-ui-primary bg-ui-primary-soft shadow-ui-sm'
                          : isDone
                          ? 'border-ui-success/40 bg-ui-success-soft/20 text-ui-text'
                          : 'border-ui-border bg-ui-page-alt text-ui-muted opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-xl font-black text-xs ${
                            isCurrent
                              ? 'bg-ui-primary text-ui-primary-fg'
                              : isDone
                              ? 'bg-ui-success text-white'
                              : 'bg-ui-surface border border-ui-border text-ui-muted'
                          }`}
                        >
                          {st.icon}
                        </div>
                        <span className="text-xs font-black">{st.title}</span>
                      </div>
                      <p className="text-[11px] font-bold text-ui-muted">{st.desc}</p>
                    </div>
                  );
                })}
              </div>

              {/* Delivery Details Callout if Delivery */}
              {order.order_type === 'delivery' && (
                <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 space-y-2 text-xs">
                  <p className="font-black text-sky-800 dark:text-sky-200 flex items-center gap-1.5">
                    <Truck className="h-4 w-4" /> {isAr ? 'تفاصيل التوصيل وموقع الاستلام' : 'Delivery Details'}
                  </p>
                  <p className="font-bold text-ui-text">{order.notes || (isAr ? 'عنوان التوصيل مسجل' : 'Delivery Address recorded')}</p>
                  <div className="pt-2 border-t border-sky-500/20 flex justify-between font-bold text-sky-900 dark:text-sky-100">
                    <span>{isAr ? 'حالة التوصيل الحالية:' : 'Delivery status:'}</span>
                    <span className="font-black">
                      {currentStep >= 3
                        ? (isAr ? '✅ تم التسليم للعميل' : 'Delivered')
                        : currentStep >= 2
                        ? (isAr ? '🛵 السائق في الطريق إليك' : 'Out for delivery')
                        : (isAr ? '👨‍🍳 جاري التحضير والتجهيز' : 'Preparing')}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Order Items Breakdown */}
            <div className="rounded-3xl border border-ui-border bg-ui-surface p-6 shadow-ui-sm space-y-4">
              <h3 className="text-sm font-black text-ui-text flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-ui-accent" />
                {isAr ? 'أصناف الطلب الحالي' : 'Current Order Items'}
              </h3>

              <div className="divide-y divide-ui-border">
                {orderItems.map((it) => (
                  <div key={it.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-ui-accent min-w-6">×{it.quantity}</span>
                      <span className="font-black text-ui-text">{(it as any).product?.name || (isAr ? 'صنف وجبة' : 'Item')}</span>
                    </div>
                    <span className="font-black text-ui-text">{formatCurrency(it.total, currency, lang)}</span>
                  </div>
                ))}
              </div>

              {/* Totals Summary */}
              <div className="pt-4 border-t border-ui-border space-y-1.5 text-xs font-bold text-ui-muted">
                <div className="flex justify-between">
                  <span>{isAr ? 'المجموع الفرعي:' : 'Subtotal:'}</span>
                  <span>{formatCurrency(order.subtotal, currency, lang)}</span>
                </div>
                {order.order_type === 'delivery' && (
                  <div className="flex justify-between">
                    <span>{isAr ? 'رسوم التوصيل:' : 'Delivery Fee:'}</span>
                    <span>{formatCurrency(order.delivery_fee || 20, currency, lang)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>{isAr ? 'ضريبة القيمة المضافة:' : 'VAT:'}</span>
                  <span>{formatCurrency(order.tax, currency, lang)}</span>
                </div>
                <div className="flex justify-between text-sm font-black text-ui-text pt-2 border-t border-ui-border">
                  <span>{isAr ? 'الإجمالي المدفوع:' : 'Total Amount:'}</span>
                  <span className="text-ui-accent">{formatCurrency(order.total, currency, lang)}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
