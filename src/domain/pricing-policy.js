import { calculatePrice } from './pricing.js';

export const PRICING_POLICY=Object.freeze({
  public:Object.freeze({calculation_method:'markup_percentage',calculation_value:35,minimum_margin:10,rounding_rule:'ending_90'}),
  reseller:Object.freeze({calculation_method:'markup_percentage',calculation_value:18,minimum_margin:8,rounding_rule:'ending_90'}),
  supplier_cost_review_threshold:100000,
  sale_price_review_threshold:100000
});

export function reviewPricingInput({supplierCost=0,additionalCost=0,quantity=1}={}){
  const cost=Number(supplierCost||0)+Number(additionalCost||0);
  const qty=Math.max(1,Number(quantity||1));
  if(!Number.isFinite(cost)||cost<=0)return {status:'review',reason:'missing_or_invalid_cost'};
  if(cost>=PRICING_POLICY.supplier_cost_review_threshold)return {status:'review',reason:'supplier_cost_over_100k'};
  const unitCost=cost/qty;
  if(!Number.isFinite(unitCost)||unitCost<=0)return {status:'review',reason:'invalid_unit_cost'};
  return {status:'published',reason:null};
}

export function commercialPrices({supplierCost=0,additionalCost=0}={}){
  const realCost=Number(supplierCost||0)+Number(additionalCost||0);
  return {
    realCost,
    publicPrice:calculatePrice(realCost,PRICING_POLICY.public),
    resellerPrice:calculatePrice(realCost,PRICING_POLICY.reseller)
  };
}
