export const defaultRules = Object.freeze([
  { name: 'Standard', min: 0, max: 5, route: 'Auto', active: true },
  { name: 'Manager', min: 5, max: 15, route: 'Manager', active: true },
  { name: 'Director', min: 15, max: 25, route: 'Director', active: true },
  { name: 'Blocked', min: 25, max: 100, route: 'Block', active: true },
]);

export function evaluate(discount, rules = defaultRules) {
  if (typeof discount !== 'number' || !Number.isFinite(discount) || discount < 0 || discount > 100) {
    throw new Error('Discount must be a number between 0 and 100.');
  }
  const active = rules.filter(rule => rule.active);
  for (const rule of active) {
    if (!Number.isFinite(rule.min) || !Number.isFinite(rule.max) || rule.min < 0 || rule.max > 100 ||
        rule.min >= rule.max || !['Auto', 'Manager', 'Director', 'Block'].includes(rule.route)) {
      throw new Error('Invalid discount rule. Check the policy configuration.');
    }
  }
  const matches = active.filter(rule => (discount > rule.min || (discount === 0 && rule.min === 0)) && discount <= rule.max);
  if (matches.length > 1) throw new Error('Overlapping discount rules. Contact an administrator.');
  if (!matches.length) throw new Error('No active rule covers this discount. Contact an administrator.');
  return { ...matches[0] };
}

export function calculate(amount, discount) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999999999.99) throw new Error('Enter a positive amount within the supported range.');
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error('Discount must be between 0 and 100.');
  return { saving: Math.round(amount * discount) / 100, net: Math.round(amount * (1 - discount / 100) * 100) / 100 };
}

export function submitRequest({ customer, amount, discount }, rules = defaultRules) {
  if (!customer?.trim() || customer.trim().length > 120) throw new Error('Enter a customer name of 1–120 characters.');
  const totals = calculate(amount, discount);
  const rule = evaluate(discount, rules);
  if (rule.route === 'Block') throw new Error('Discount exceeds policy. Reduce it before submitting.');
  return {
    customer: customer.trim(), amount, discount, ...totals,
    rule: rule.name, route: rule.route,
    approver: rule.route === 'Auto' ? 'Policy engine' : rule.route === 'Manager' ? 'Priya · Sales Manager' : 'Arjun · Sales Director',
    status: rule.route === 'Auto' ? 'Approved' : 'Pending',
  };
}

export function decideRequest(request, action, actor, comment = '') {
  if (request.status !== 'Pending') throw new Error('Only pending requests can be reviewed.');
  if (actor !== request.route) throw new Error('Switch to the assigned approver to review this request.');
  if (!['Approved', 'Rejected'].includes(action)) throw new Error('Invalid decision.');
  return { ...request, status: action, comment: comment.trim() };
}
