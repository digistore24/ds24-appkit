<!-- ds24-appkit:placeholder -->
Esta página todavía no se ha rellenado.

Una política de privacidad conforme al **art. 13 del RGPD** es obligatoria en
cuanto esta aplicación trata datos personales — y lo hace a partir de la primera
cuenta.

**No la escribas a partir de una plantilla genérica.** Una política genérica
describe una aplicación distinta de la tuya y omite justo lo que ocurre aquí de
verdad: que las direcciones IP se cuentan en memoria durante quince minutos, que
los webhooks sin procesar de Digistore24 se conservan 60 días, y qué empresa de
IA recibe lo que tus clientes escriben en el chat.

La base ya existe: **`docs/data-protection.md`** es el inventario, y se leyó del
código en lugar de recordarse. El skill **`compliance-check`** redacta la
política a partir de él y solo te pregunta lo que no está en el disco.

`node run.mjs legal-check` te dice en cualquier momento qué páginas legales
siguen mostrando este texto.
