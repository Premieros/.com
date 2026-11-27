import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Search, Plus, Minus, Trash2, ArrowRight,
  Truck, ShoppingBag, Utensils, CheckCircle2, AlertCircle, Clock,
  MapPin, Phone, User as UserIcon, X,
} from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { formatCurrency } from '@/lib/format';
import { Logo } from '@/components/Logo';
import { ScrollableCardStrip } from '@/components/ScrollableCardStrip';
import type { Category, Product, OrderType } from '@/lib/types';

interface CartLine {
  product: Product;
  quantity: number;
  modifiers: { name: string; price: number }[];
  note: string;
}

export function CustomerOrderPage() {
  const { lang, setLang, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const isAr = lang === 'ar';
  const navigate = useNavigate();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState('');

  // Cart & Order state
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>('dine_in');

  // Customer Delivery Info
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const currency = 'EGP';
  const deliveryFee = orderType === 'delivery' && deliveryAddress.trim().length > 0 ? 20 : 0;

  useEffect(() => {
    async function loadMenu() {
      setLoading(true);
      try {
        const [catRes, prodRes] = await Promise.all([
          supabase.from('categories').select('*').order('name'),
          supabase.from('products').select('*').eq('is_active', true).order('name'),
        ]);
        if (catRes.data) setCategories(catRes.data);
        if (prodRes.data) setProducts(prodRes.data);
      } catch (err) {
        console.error('Error loading menu', err);
      } finally {
        setLoading(false);
      }
    }
    loadMenu();
  }, []);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchCat = !selectedCategory || p.category_id === selectedCategory;
      const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.name_en && p.name_en.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [products, selectedCategory, search]);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id && item.modifiers.length === 0);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id && item.modifiers.length === 0
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1, modifiers: [], note: '' }];
    });
  };

  const updateQuantity = (index: number, delta: number) => {
    setCart((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      const newQty = current.quantity + delta;
      if (newQty <= 0) {
        next.splice(index, 1);
        return next;
      }
      next[index] = { ...current, quantity: newQty };
      return next;
    });
  };

  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  }, [cart]);

  const tax = subtotal * 0.14;
  const grandTotal = subtotal + tax + deliveryFee;
  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleSubmitOrder = async () => {
    if (cart.length === 0) return;
    setErrorMessage('');

    if (orderType === 'delivery') {
      if (!customerPhone.trim() || !deliveryAddress.trim()) {
        setErrorMessage(isAr ? 'يرجى إدخال رقم الهاتف وعنوان التوصيل لإتمام الطلب' : 'Please provide phone and delivery address to proceed');
        return;
      }
    }

    setSubmitting(true);
    try {
      const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;
      const { data: newOrder, error: orderErr } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumber,
          order_type: orderType,
          status: 'open',
          payment_status: 'pending',
          subtotal,
          tax,
          delivery_fee: deliveryFee,
          total: grandTotal,
          notes: `${orderNotes ? orderNotes + ' | ' : ''}Customer: ${customerName || 'Guest'} (${customerPhone || 'N/A'}) - Address: ${deliveryAddress || 'Dine/Takeaway'}`,
        })
        .select()
        .single();

      if (orderErr) throw orderErr;

      const orderItemsPayload = cart.map((item) => ({
        order_id: newOrder.id,
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.product.price,
        total: item.product.price * item.quantity,
        notes: item.note || null,
      }));

      await supabase.from('order_items').insert(orderItemsPayload);

      // Save active order ID in session storage for current tracking
      sessionStorage.setItem('premier_current_order_id', newOrder.id);

      navigate(`/track/${newOrder.id}`);
    } catch (err: any) {
      setErrorMessage(err.message || (isAr ? 'حدث خطأ أثناء إرسال الطلب' : 'Failed to submit order'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-ui-page text-ui-text pb-24">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-ui-border bg-ui-surface/95 backdrop-blur-md px-4 py-3 shadow-ui-xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo size={32} />
            <div>
              <p className="text-sm font-black tracking-tight text-ui-text">Premier Dining</p>
              <p className="text-[10px] font-bold text-ui-muted">{isAr ? 'قائمة الطعام والطلب الإلكتروني' : 'Online Menu & Ordering'}</p>
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
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative flex items-center gap-1.5 rounded-xl bg-ui-primary px-3 py-1.5 text-xs font-black text-ui-primary-fg shadow-ui-xs hover:bg-ui-primary-hover active:scale-95 transition"
            >
              <ShoppingCart className="h-4 w-4" />
              <span>{isAr ? 'السلة' : 'Cart'}</span>
              {totalCartCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white text-ui-primary text-[11px] font-black px-1">
                  {totalCartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-5 space-y-5">
        {/* Search & Categories */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ui-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? 'ابحث في المنيو عن وجبتك المفضلة...' : 'Search delicious dishes...'}
              className="w-full ps-9 pe-4 py-2.5 rounded-2xl border border-ui-border bg-ui-surface text-sm font-bold text-ui-text placeholder:text-ui-muted shadow-ui-xs focus:outline-none focus:border-ui-primary"
            />
          </div>

          {/* Categories with ScrollableCardStrip */}
          <ScrollableCardStrip testId="customer-category-strip">
            <div className="flex items-center gap-2 py-1">
              <button
                type="button"
                onClick={() => setSelectedCategory('')}
                className={`shrink-0 rounded-xl px-4 py-2 text-xs font-black transition ${
                  !selectedCategory
                    ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm'
                    : 'border border-ui-border bg-ui-surface text-ui-muted hover:text-ui-text'
                }`}
              >
                {isAr ? 'كل الأصناف' : 'All Dishes'}
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCategory(selectedCategory === c.id ? '' : c.id)}
                  className={`shrink-0 rounded-xl px-4 py-2 text-xs font-black transition ${
                    selectedCategory === c.id
                      ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm'
                      : 'border border-ui-border bg-ui-surface text-ui-muted hover:text-ui-text'
                  }`}
                >
                  {isAr ? c.name : c.name_en || c.name}
                </button>
              ))}
            </div>
          </ScrollableCardStrip>
        </div>

        {/* Dishes Grid */}
        {loading ? (
          <div className="text-center py-16 text-ui-muted">{isAr ? 'جاري تحميل المنيو...' : 'Loading menu...'}</div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-dashed border-ui-border bg-ui-surface p-8">
            <p className="text-base font-black text-ui-text">{isAr ? 'لا توجد نتائج مطابقة' : 'No matching dishes found'}</p>
            <p className="text-xs text-ui-muted mt-1">{isAr ? 'جرب البحث باسم آخر أو اختيار تصنيف مختلف' : 'Try searching for something else'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map((p) => (
              <div
                key={p.id}
                className="group rounded-2xl border border-ui-border bg-ui-surface p-4 shadow-ui-xs hover:border-ui-primary/50 hover:shadow-ui-sm transition flex flex-col justify-between"
              >
                <div>
                  {p.image_url && (
                    <div className="aspect-video w-full rounded-xl overflow-hidden bg-ui-page-alt mb-3">
                      <img src={p.image_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black text-ui-text">{isAr ? p.name : p.name_en || p.name}</h3>
                      {p.description && <p className="text-xs text-ui-muted mt-1 line-clamp-2">{p.description}</p>}
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-ui-border flex items-center justify-between">
                  <span className="text-sm font-black text-ui-accent">{formatCurrency(p.price, currency, lang)}</span>
                  <button
                    type="button"
                    onClick={() => addToCart(p)}
                    className="flex items-center gap-1.5 rounded-xl bg-ui-primary-soft hover:bg-ui-primary text-ui-accent hover:text-ui-primary-fg px-3 py-1.5 text-xs font-black shadow-ui-xs active:scale-95 transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {isAr ? 'إضافة' : 'Add'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Cart Drawer Modal */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ui-text/40 backdrop-blur-xs">
          <div className="w-full max-w-md bg-ui-surface h-full shadow-ui-xl flex flex-col border-s border-ui-border animate-in slide-in-from-right">
            {/* Cart Header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-ui-border">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-ui-accent" />
                <h2 className="text-base font-black text-ui-text">{isAr ? 'سلة الطلب' : 'Your Cart'}</h2>
                <span className="rounded-full bg-ui-primary-soft px-2 py-0.5 text-xs font-black text-ui-accent">{totalCartCount}</span>
              </div>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="rounded-lg p-1.5 text-ui-muted hover:text-ui-text hover:bg-ui-page-alt transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Cart Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Order Type Selector */}
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-ui-muted">{isAr ? 'اختر نوع الطلب:' : 'Order Type:'}</p>
                <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-ui-page-alt p-1">
                  <button
                    type="button"
                    onClick={() => setOrderType('dine_in')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-black transition ${
                      orderType === 'dine_in' ? 'bg-ui-primary text-ui-primary-fg shadow-ui-xs' : 'text-ui-muted hover:text-ui-text'
                    }`}
                  >
                    <Utensils className="h-3.5 w-3.5" /> {isAr ? 'صالة' : 'Dine-in'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderType('takeaway')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-black transition ${
                      orderType === 'takeaway' ? 'bg-ui-primary text-ui-primary-fg shadow-ui-xs' : 'text-ui-muted hover:text-ui-text'
                    }`}
                  >
                    <ShoppingBag className="h-3.5 w-3.5" /> {isAr ? 'سفري' : 'Takeaway'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderType('delivery')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-black transition ${
                      orderType === 'delivery' ? 'bg-ui-primary text-ui-primary-fg shadow-ui-xs' : 'text-ui-muted hover:text-ui-text'
                    }`}
                  >
                    <Truck className="h-3.5 w-3.5" /> {isAr ? 'توصيل' : 'Delivery'}
                  </button>
                </div>
              </div>

              {/* Delivery / Table Details */}
              {orderType === 'dine_in' && (
                <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3">
                  <label className="block text-xs font-bold text-ui-muted mb-1">{isAr ? 'رقم الطاولة (اختياري)' : 'Table Number (optional)'}</label>
                  <input
                    type="text"
                    value={tableNumber}
                    onChange={(e) => setTableNumber(e.target.value)}
                    placeholder="مثال: T05"
                    className="w-full rounded-lg border border-ui-border bg-ui-surface px-3 py-1.5 text-xs font-bold text-ui-text focus:outline-none focus:border-ui-primary"
                  />
                </div>
              )}

              {orderType === 'delivery' && (
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 space-y-2">
                  <p className="text-xs font-black text-sky-700 dark:text-sky-300 flex items-center gap-1">
                    <Truck className="h-4 w-4" /> {isAr ? 'بيانات التوصيل' : 'Delivery Details'}
                  </p>
                  <div>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder={isAr ? 'اسم العميل' : 'Customer Name'}
                      className="w-full rounded-lg border border-ui-border bg-ui-surface px-3 py-1.5 text-xs font-bold text-ui-text mb-2 focus:outline-none focus:border-ui-primary"
                    />
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder={isAr ? 'رقم الهاتف للتواصل *' : 'Phone number *'}
                      className="w-full rounded-lg border border-ui-border bg-ui-surface px-3 py-1.5 text-xs font-bold text-ui-text mb-2 focus:outline-none focus:border-ui-primary"
                    />
                    <textarea
                      rows={2}
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder={isAr ? 'العنوان التفصيلي للتوصيل *' : 'Full delivery address *'}
                      className="w-full rounded-lg border border-ui-border bg-ui-surface px-3 py-1.5 text-xs font-bold text-ui-text focus:outline-none focus:border-ui-primary"
                    />
                  </div>

                  {/* Delivery Fee Notice */}
                  <div className="pt-2 border-t border-sky-500/20 flex items-center justify-between text-xs font-bold">
                    <span className="text-sky-800 dark:text-sky-200">{isAr ? 'رسوم التوصيل:' : 'Delivery Fee:'}</span>
                    <span className="font-black text-ui-text">
                      {deliveryAddress.trim().length > 0 ? (
                        formatCurrency(20, currency, lang)
                      ) : (
                        <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                          {isAr ? 'يلزم إدخال العنوان لاحتساب الرسوم' : 'Enter address to calculate'}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )}

              {/* Cart Items List */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-ui-muted">{isAr ? 'الأصناف المحددة:' : 'Selected Items:'}</p>
                {cart.length === 0 ? (
                  <div className="text-center py-8 text-ui-muted text-xs font-bold">{isAr ? 'السلة فارغة' : 'Your cart is empty'}</div>
                ) : (
                  cart.map((item, idx) => (
                    <div key={idx} className="rounded-xl border border-ui-border bg-ui-page-alt p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-ui-text truncate">{isAr ? item.product.name : item.product.name_en || item.product.name}</p>
                        <p className="text-[11px] font-bold text-ui-muted">{formatCurrency(item.product.price, currency, lang)}</p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => updateQuantity(idx, -1)}
                          className="h-6 w-6 rounded-lg border border-ui-border bg-ui-surface flex items-center justify-center text-ui-text hover:bg-ui-page"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-5 text-center text-xs font-black text-ui-text">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(idx, 1)}
                          className="h-6 w-6 rounded-lg bg-ui-primary text-ui-primary-fg flex items-center justify-center hover:bg-ui-primary-hover"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Order Notes */}
              <div>
                <label className="block text-xs font-bold text-ui-muted mb-1">{isAr ? 'ملاحظات خاصة على الطلب' : 'Order Notes'}</label>
                <input
                  type="text"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder={isAr ? 'مثال: بدون بصل / صوص جانبي...' : 'e.g. extra napkins / sauce on side'}
                  className="w-full rounded-lg border border-ui-border bg-ui-surface px-3 py-1.5 text-xs font-bold text-ui-text focus:outline-none focus:border-ui-primary"
                />
              </div>

              {errorMessage && (
                <div className="rounded-xl border border-ui-danger/30 bg-ui-danger-soft p-3 text-xs font-bold text-ui-danger flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>

            {/* Cart Footer */}
            {cart.length > 0 && (
              <div className="p-4 border-t border-ui-border bg-ui-surface space-y-3">
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-ui-muted font-bold">
                    <span>{isAr ? 'المجموع الفرعي:' : 'Subtotal:'}</span>
                    <span>{formatCurrency(subtotal, currency, lang)}</span>
                  </div>
                  {orderType === 'delivery' && (
                    <div className="flex justify-between text-ui-muted font-bold">
                      <span>{isAr ? 'رسوم التوصيل:' : 'Delivery:'}</span>
                      <span>{deliveryFee > 0 ? formatCurrency(deliveryFee, currency, lang) : (isAr ? 'تحدد حسب العنوان' : 'Pending')}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-ui-muted font-bold">
                    <span>{isAr ? 'ضريبة القيمة المضافة (14%):' : 'VAT (14%):'}</span>
                    <span>{formatCurrency(tax, currency, lang)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-black text-ui-text pt-2 border-t border-ui-border">
                    <span>{isAr ? 'الإجمالي النهائي:' : 'Total:'}</span>
                    <span className="text-ui-accent">{formatCurrency(grandTotal, currency, lang)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmitOrder}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-ui-primary py-3 text-sm font-black text-ui-primary-fg shadow-ui-sm hover:bg-ui-primary-hover active:scale-95 transition disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{submitting ? (isAr ? 'جاري إرسال الطلب...' : 'Submitting...') : (isAr ? 'تأكيد وإرسال الطلب' : 'Confirm & Submit Order')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
