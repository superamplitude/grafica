export function roundPrice(price, rule = 'ending_90') {
  const value = Math.max(0, Number(price) || 0);
  switch (rule) {
    case 'ending_99': {
      const base = Math.floor(value);
      return base + 0.99 < value ? base + 1.99 : base + 0.99;
    }
    case 'ending_90': {
      const base = Math.floor(value);
      return base + 0.90 < value ? base + 1.90 : base + 0.90;
    }
    case 'next_integer':
      return Math.ceil(value);
    case 'multiple_5':
      return Math.ceil(value / 5) * 5;
    case 'none':
    default:
      return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}

export function calculatePrice(variant, rule = {}) {
  const supplierCost = Math.max(0, Number(variant?.supplier_cost ?? variant?.supplierCost ?? 0) || 0);
  const additionalCost = Math.max(0, Number(variant?.additional_cost ?? variant?.additionalCost ?? 0) || 0);
  const cost = supplierCost + additionalCost;
  const method = String(rule.calculation_method ?? rule.calculationMethod ?? 'real_margin_percentage');
  const value = Number(rule.calculation_value ?? rule.calculationValue ?? 35) || 0;
  const minimumMargin = Math.max(0, Number(rule.minimum_margin ?? rule.minimumMargin ?? 0) || 0);
  const roundingRule = String(rule.rounding_rule ?? rule.roundingRule ?? 'ending_90');

  let price;
  switch (method) {
    case 'markup_percentage':
      price = cost * (1 + value / 100);
      break;
    case 'real_margin_percentage':
      price = value >= 100 ? cost : cost / Math.max(0.0001, 1 - value / 100);
      break;
    case 'fixed_addition':
      price = cost + value;
      break;
    case 'multiplier':
      price = cost * Math.max(0, value);
      break;
    case 'manual_price':
      price = value;
      break;
    default:
      price = cost;
  }

  if (minimumMargin > 0 && minimumMargin < 100) {
    const minimumPrice = cost / (1 - minimumMargin / 100);
    price = Math.max(price, minimumPrice);
  }

  price = roundPrice(Math.max(cost, price), roundingRule);
  const margin = price > 0 ? ((price - cost) / price) * 100 : 0;

  return {
    real_cost: Number(cost.toFixed(4)),
    price: Number(price.toFixed(2)),
    margin: Number(margin.toFixed(4)),
    rule_id: Number(rule.id || 0)
  };
}
