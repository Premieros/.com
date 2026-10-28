'use strict';
const crypto = require('node:crypto');
const { createDeviceRegistry } = require('./devices.cjs');

// Standalone, local-only atomic sales engine. Does not call Supabase.
// All values are integer minor units; quantities are integer base units.
function createOfflineSalesEngine(db, branchId) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS offline_catalog (
      branch_id TEXT NOT NULL,sku TEXT NOT NULL,revision INTEGER NOT NULL,
      sale_price_minor INTEGER NOT NULL,unit_cost_minor INTEGER NOT NULL,PRIMARY KEY(branch_id,sku)
    );
    CREATE TABLE IF NOT EXISTS offline_stock (
      branch_id TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>=0),
      unit_cost_minor INTEGER NOT NULL CHECK(unit_cost_minor>=0),
      PRIMARY KEY(branch_id,sku)
    );
    CREATE TABLE IF NOT EXISTS offline_item_links (
      branch_id TEXT NOT NULL,sku TEXT NOT NULL,product_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,
      unit_name TEXT NOT NULL,product_name TEXT NOT NULL,PRIMARY KEY(branch_id,sku),
      FOREIGN KEY(branch_id,sku) REFERENCES offline_stock(branch_id,sku)
    );
    CREATE TABLE IF NOT EXISTS offline_stock_movements (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, sku TEXT NOT NULL,
      sale_id TEXT NOT NULL, delta INTEGER NOT NULL CHECK(delta < 0),
      balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(branch_id,sale_id,sku)
    );
    CREATE TABLE IF NOT EXISTS offline_sales (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, key TEXT NOT NULL,
      canonical TEXT NOT NULL, total_minor INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(branch_id,key)
    );
    CREATE TABLE IF NOT EXISTS offline_sale_lines (
      sale_id TEXT NOT NULL REFERENCES offline_sales(id), sku TEXT NOT NULL,
      quantity INTEGER NOT NULL, price_minor INTEGER NOT NULL,
      cost_minor INTEGER NOT NULL, canonical TEXT
    );
    CREATE TABLE IF NOT EXISTS offline_journal (
      sale_id TEXT NOT NULL REFERENCES offline_sales(id),
      account TEXT NOT NULL, debit_minor INTEGER NOT NULL DEFAULT 0,
      credit_minor INTEGER NOT NULL DEFAULT 0,
      CHECK(debit_minor>=0 AND credit_minor>=0),
      CHECK((debit_minor=0) != (credit_minor=0))
    );
    CREATE TABLE IF NOT EXISTS offline_outbox (
      event_id TEXT PRIMARY KEY, sale_id TEXT NOT NULL UNIQUE,
      branch_id TEXT NOT NULL, payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','acknowledged'))
    );
  `);
  if(!db.prepare('PRAGMA table_info(offline_sale_lines)').all().some(c=>c.name==='canonical')){
    db.exec('ALTER TABLE offline_sale_lines ADD COLUMN canonical TEXT');
    // Preserve the historical snapshot carried by older immutable outbox events, never today's mapping.
    db.exec(`UPDATE offline_sale_lines SET canonical=(SELECT json_extract(e.value,'$.canonical')
      FROM offline_outbox o,json_each(o.payload,'$.lines')e WHERE o.sale_id=offline_sale_lines.sale_id
      AND json_valid(o.payload) AND json_extract(e.value,'$.sku')=offline_sale_lines.sku LIMIT 1)`);
  }
  const {audit} = createDeviceRegistry(db, branchId);
  function setOpeningStock(sku, quantity, unitCostMinor, actor='administrator') {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(sku) ||
      !Number.isSafeInteger(quantity) || quantity<0 ||
      !Number.isSafeInteger(unitCostMinor) || unitCostMinor<0)
      throw Error('INVALID_OPENING_STOCK');
    // Only allow initialization, never use this path to adjust existing balances.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO offline_stock(branch_id,sku,quantity,unit_cost_minor) VALUES(?,?,?,?)')
        .run(branchId,sku,quantity,unitCostMinor);
      audit(actor,'stock.opening',sku,{quantity,unitCostMinor});
      db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }

  function commitSale({key,lines,paymentAccount='cash',actor='administrator'}) {
    if (typeof key!=='string' || key.length<8 || key.length>160 ||
      !['cash','bank'].includes(paymentAccount) || !Array.isArray(lines) ||
      lines.length===0 || lines.length>100) throw Error('INVALID_SALE');
    const normalized=lines.map(x=>{
      if (!x || !/^[a-zA-Z0-9_.-]{1,80}$/.test(x.sku||'') ||
        !Number.isSafeInteger(x.quantity) || x.quantity<=0 ||
        !Number.isSafeInteger(x.priceMinor) || x.priceMinor<=0)
        throw Error('INVALID_SALE_LINE');
      return {sku:x.sku,quantity:x.quantity,priceMinor:x.priceMinor};
    });
    if (new Set(normalized.map(x=>x.sku)).size!==normalized.length) throw Error('DUPLICATE_SKU_LINE');
    const canonical=JSON.stringify({lines:normalized,paymentAccount});
    db.exec('BEGIN IMMEDIATE');
    try {
      const old=db.prepare('SELECT id,canonical,total_minor FROM offline_sales WHERE branch_id=? AND key=?').get(branchId,key);
      if (old) {
        if (old.canonical!==canonical) throw Error('IDEMPOTENCY_CONFLICT');
        db.exec('COMMIT');
        return {saleId:old.id,totalMinor:old.total_minor,duplicate:true};
      }
      let total=0,cost=0;
      const costing=[];
      for(const line of normalized) {
        const stock=db.prepare('SELECT quantity,unit_cost_minor FROM offline_stock WHERE branch_id=? AND sku=?').get(branchId,line.sku);
        if (!stock || stock.quantity<line.quantity) throw Error('INSUFFICIENT_STOCK: '+line.sku);
        const published=db.prepare('SELECT sale_price_minor FROM offline_catalog WHERE branch_id=? AND sku=?').get(branchId,line.sku);
        if(published && published.sale_price_minor!==line.priceMinor)throw Error('PRICE_CHANGED');
        const revenue=line.quantity*line.priceMinor;
        const cogs=line.quantity*stock.unit_cost_minor;
        if (!Number.isSafeInteger(revenue)||!Number.isSafeInteger(cogs) ||
            !Number.isSafeInteger(total+revenue)||!Number.isSafeInteger(cost+cogs)) throw Error('AMOUNT_OVERFLOW');
        total+=revenue;cost+=cogs;
        const link=db.prepare('SELECT product_id,warehouse_id,unit_name,product_name FROM offline_item_links WHERE branch_id=? AND sku=?').get(branchId,line.sku);
        costing.push({...line,costMinor:cogs,...(link?{canonical:{productId:link.product_id,warehouseId:link.warehouse_id,unitName:link.unit_name,productName:Array.from(link.product_name).slice(0,120).join('')}}:{})});
      }
      const id=crypto.randomUUID();
      const eventPayload=JSON.stringify({saleId:id,branchId,key,totalMinor:total,lines:costing,paymentAccount});
      if(Buffer.byteLength(eventPayload)>65536)throw Error('SALE_EVENT_TOO_LARGE');
      db.prepare('INSERT INTO offline_sales(id,branch_id,key,canonical,total_minor) VALUES(?,?,?,?,?)').run(id,branchId,key,canonical,total);
      for(const line of costing) {
        const changed=db.prepare('UPDATE offline_stock SET quantity=quantity-? WHERE branch_id=? AND sku=? AND quantity>=?')
          .run(line.quantity,branchId,line.sku,line.quantity);
        if(changed.changes!==1) throw Error('INSUFFICIENT_STOCK');
        const current=db.prepare('SELECT quantity FROM offline_stock WHERE branch_id=? AND sku=?').get(branchId,line.sku);
        db.prepare('INSERT INTO offline_stock_movements(id,branch_id,sku,sale_id,delta,balance_after) VALUES(?,?,?,?,?,?)')
          .run(crypto.randomUUID(),branchId,line.sku,id,-line.quantity,current.quantity);
        db.prepare('INSERT INTO offline_sale_lines(sale_id,sku,quantity,price_minor,cost_minor,canonical) VALUES(?,?,?,?,?,?)')
          .run(id,line.sku,line.quantity,line.priceMinor,line.costMinor,line.canonical?JSON.stringify(line.canonical):null);
      }
      const entry=db.prepare('INSERT INTO offline_journal(sale_id,account,debit_minor,credit_minor) VALUES(?,?,?,?)');
      entry.run(id,paymentAccount,total,0);
      entry.run(id,'sales_revenue',0,total);
      if(cost>0){entry.run(id,'cost_of_goods_sold',cost,0);entry.run(id,'inventory',0,cost);}
      db.prepare('INSERT INTO offline_outbox(event_id,sale_id,branch_id,payload) VALUES(?,?,?,?)')
        .run(id,id,branchId,eventPayload);
      const balance=db.prepare('SELECT sum(debit_minor)-sum(credit_minor) n FROM offline_journal WHERE sale_id=?').get(id).n;
      if(balance!==0) throw Error('UNBALANCED_JOURNAL');
      audit(actor,'sale.commit',id,{key,totalMinor:total});
      db.exec('COMMIT');
      return {saleId:id,totalMinor:total,duplicate:false};
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }
  return {setOpeningStock,commitSale};
}
module.exports={createOfflineSalesEngine};
