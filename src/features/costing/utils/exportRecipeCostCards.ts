import type { ProductCostingDetail } from '@/lib/types';

/** Recipe cards laid out side by side as in the kitchen costing workbook. */
export async function exportRecipeCostCards(
  details: ProductCostingDetail[],
  filename = 'product-recipe-cost-cards',
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const perSheet = 3;
  for (let start = 0; start < details.length; start += perSheet) {
    const chunk = details.slice(start, start + perSheet);
    const heights = chunk.map((product) => (product.recipe_items?.length || 0) + (product.components?.length || 0));
    const rows = Math.max(...heights, 0) + 5;
    const matrix: (string | number)[][] = Array.from({ length: rows }, () => Array(14).fill(''));
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
    chunk.forEach((product, index) => {
      const offset = index * 5;
      matrix[0][offset] = product.product_name || 'Product';
      merges.push({ s: { r: 0, c: offset }, e: { r: 0, c: offset + 3 } });
      ['product / المكون', 'الكمية', 'السعر', 'الإجمالي'].forEach((header, column) => { matrix[1][offset + column] = header; });
      const components = [
        ...(product.components || []).map((line) => ({ name: line.component_name, quantity: Number(line.quantity), price: Number(line.unit_cost), cost: Number(line.line_cost) })),
        ...(product.recipe_items || []).map((line) => ({
          name: line.component_group_name ? `${line.component_group_name} / ${line.raw_material_name}` : line.raw_material_name,
          quantity: Number(line.quantity), price: Number(line.unit_cost), cost: Number(line.line_cost),
        })),
      ];
      components.forEach((line, position) => {
        const row = position + 2;
        matrix[row][offset] = line.name;
        matrix[row][offset + 1] = line.quantity;
        matrix[row][offset + 2] = line.price;
        // Reflect canonical server cost (including wastage, if supplied).
        matrix[row][offset + 3] = line.cost;
      });
      const footer = components.length + 2;
      matrix[footer][offset] = 'إجمالي تكلفة المنتج';
      merges.push({ s: { r: footer, c: offset }, e: { r: footer, c: offset + 2 } });
      matrix[footer][offset + 3] = components.reduce((sum, line) => sum + line.cost, 0);
      matrix[footer + 1][offset] = 'سعر البيع';
      matrix[footer + 1][offset + 3] = Number(product.sale_price || 0);
    });
    const sheet = XLSX.utils.aoa_to_sheet(matrix);
    sheet['!merges'] = merges;
    sheet['!cols'] = Array.from({ length: 14 }, (_, col) => ({ wch: col % 5 === 0 ? 35 : col % 5 === 4 ? 3 : 15 }));
    sheet['!rows'] = [{ hpt: 30 }, { hpt: 25 }];
    sheet['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
    sheet['!margins'] = { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 };
    for (const productIndex of chunk.keys()) {
      const offset = productIndex * 5;
      const maxLine = heights[productIndex] + 3;
      for (let row = 0; row <= maxLine; row++) {
        for (let col = offset; col <= offset + 3; col++) {
          const key = XLSX.utils.encode_cell({ r: row, c: col });
          const cell = sheet[key];
          if (!cell) continue;
          cell.s = {
            font: { bold: row < 2 || row === heights[productIndex] + 2, color: { rgb: row === 0 ? 'FFFFFF' : '172554' } },
            fill: { fgColor: { rgb: row === 0 ? '1D4ED8' : row === 1 ? 'DBEAFE' : row === heights[productIndex] + 2 ? 'DCFCE7' : row % 2 ? 'F8FAFC' : 'FFFFFF' } },
            alignment: { horizontal: col === offset ? 'right' : 'center', vertical: 'center', wrapText: true },
            border: { bottom: { style: 'thin', color: { rgb: 'CBD5E1' } }, right: { style: 'thin', color: { rgb: 'CBD5E1' } } },
          };
          if (row > 1 && col > offset && typeof cell.v === 'number') cell.z = '#,##0.0000';
        }
      }
    }
    XLSX.utils.book_append_sheet(wb, sheet, `Recipes ${start / perSheet + 1}`);
  }
  if (wb.SheetNames.length === 0) throw new Error('NO_RECIPE_COST_DATA');
  XLSX.writeFile(wb, `${filename}.xlsx`, { cellStyles: true });
}
