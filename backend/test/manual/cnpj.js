/** Gera um CNPJ com dígitos verificadores válidos, a partir de uma raiz aleatória. */
function digit(base, weights) {
  const sum = base.reduce((acc, n, i) => acc + n * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function generateCnpj() {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  base[8] = 0;
  base[9] = 0;
  base[10] = 0;
  base[11] = 1;
  const d1 = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digit([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, d1, d2].join('');
}

module.exports = { generateCnpj };

if (require.main === module) {
  console.log(generateCnpj());
}
