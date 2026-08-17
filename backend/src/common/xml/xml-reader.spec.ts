import { BadRequestException } from '@nestjs/common';
import { child, children, DEFAULT_XML_LIMITS, parseXml, text } from './xml-reader';

describe('parseXml', () => {
  it('lê elementos, atributos, texto e ignora o prefixo de namespace', () => {
    const root = parseXml(`
      <?xml version="1.0" encoding="UTF-8"?>
      <nfe:NFe xmlns:nfe="http://www.portalfiscal.inf.br/nfe">
        <infNFe Id="NFe123" versao="4.00">
          <ide><nNF>4567</nNF><serie>1</serie></ide>
          <!-- comentário ignorado -->
          <det nItem="1"><prod><xProd>Cimento CP-II</xProd></prod></det>
          <det nItem="2"><prod><xProd>Areia</xProd></prod></det>
        </infNFe>
      </nfe:NFe>
    `);

    expect(root.name).toBe('NFe');
    expect(child(root, 'infNFe')?.attributes.Id).toBe('NFe123');
    expect(text(root, 'infNFe', 'ide', 'nNF')).toBe('4567');
    expect(children(child(root, 'infNFe'), 'det')).toHaveLength(2);
    expect(text(children(child(root, 'infNFe'), 'det')[1], 'prod', 'xProd')).toBe('Areia');
  });

  it('resolve as entidades predefinidas e as referências numéricas', () => {
    const root = parseXml('<x><a>M&amp;C &lt;LTDA&gt;</a><b>&#65;&#x42;</b></x>');

    expect(text(root, 'a')).toBe('M&C <LTDA>');
    expect(text(root, 'b')).toBe('AB');
  });

  it('lê CDATA como texto literal', () => {
    const root = parseXml('<x><a><![CDATA[R$ 10 & 20 <no>]]></a></x>');

    expect(text(root, 'a')).toBe('R$ 10 & 20 <no>');
  });

  // XXE: a nota chega de fora, muitas vezes por integração automática. Sem
  // recusar a declaração, `<!ENTITY x SYSTEM "file:///etc/passwd">` viraria
  // leitura de arquivo do servidor no meio do documento.
  it('recusa DOCTYPE e declaração de entidade (XXE)', () => {
    const xxe = `<?xml version="1.0"?>
      <!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
      <NFe><x>&xxe;</x></NFe>`;

    expect(() => parseXml(xxe)).toThrow(BadRequestException);
    expect(() => parseXml('<!ENTITY a "b"><x/>')).toThrow(BadRequestException);
  });

  // "Billion laughs": sem DOCTYPE não há como declarar a entidade, e a
  // referência a uma entidade não declarada é recusada em vez de ignorada.
  it('recusa entidade nomeada desconhecida', () => {
    expect(() => parseXml('<x><a>&lol9;</a></x>')).toThrow(BadRequestException);
  });

  it('recusa arquivo acima do limite de tamanho', () => {
    const big = `<x>${'a'.repeat(300)}</x>`;

    expect(() => parseXml(big, { ...DEFAULT_XML_LIMITS, maxBytes: 100 })).toThrow(
      BadRequestException,
    );
  });

  it('recusa profundidade e contagem de nós acima do limite', () => {
    const deep = '<a>'.repeat(10) + '<b/>' + '</a>'.repeat(10);

    expect(() => parseXml(deep, { ...DEFAULT_XML_LIMITS, maxDepth: 5 })).toThrow(
      BadRequestException,
    );
    expect(() => parseXml(deep, { ...DEFAULT_XML_LIMITS, maxNodes: 4 })).toThrow(
      BadRequestException,
    );
  });

  it('recusa texto de elemento acima do limite', () => {
    expect(() =>
      parseXml(`<x>${'a'.repeat(200)}</x>`, { ...DEFAULT_XML_LIMITS, maxTextLength: 50 }),
    ).toThrow(BadRequestException);
  });

  it.each([
    ['tag sem fechamento', '<x><a>1</a>'],
    ['fechamento trocado', '<x><a>1</b></x>'],
    ['dois elementos raiz', '<x/><y/>'],
    ['atributo sem aspas', '<x a=1/>'],
    ['documento vazio', '   '],
    ['texto fora da raiz', 'lixo<x/>'],
  ])('recusa XML malformado: %s', (_caso, xml) => {
    expect(() => parseXml(xml)).toThrow(BadRequestException);
  });

  it('aceita elemento vazio e auto-fechado sem texto', () => {
    const root = parseXml('<x><a/><b></b></x>');

    expect(text(root, 'a')).toBeUndefined();
    expect(text(root, 'b')).toBeUndefined();
    expect(child(root, 'inexistente')).toBeUndefined();
  });
});
