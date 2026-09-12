from __future__ import annotations

import csv
import hashlib
import html
import json
import mimetypes
import os
import re
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

OUT = Path('reference-assets')
OUT.mkdir(parents=True, exist_ok=True)
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 CentralPrintsReferenceAudit/1.0'
MAX_PER_SOURCE = 35
MIN_BYTES = 12_000

SOURCES = {
    'atualcard': [
        'https://dinhasgraficacriativa.atualcard.com.br/tabela-de-precos',
        'https://dinhasgraficacriativa.atualcard.com.br/cartao-de-visita/74',
        'https://dinhasgraficacriativa.atualcard.com.br/folders-flyers-panfletos/134',
        'https://dinhasgraficacriativa.atualcard.com.br/adesivos/1',
        'https://dinhasgraficacriativa.atualcard.com.br/banners-lonas/37',
    ],
    'giv': [
        'https://www.givonline.com.br/talao-de-pedido',
        'https://www.givonline.com.br/produto/talao-de-pedido-personalizado?id=48851',
        'https://www.givonline.com.br/produto/talao-acao-entre-amigos?id=59207',
    ],
    'zapgrafica': [
        'https://www.zapgrafica.com.br/tabelaprecos',
        'https://www.zapgrafica.com.br/produto',
        'https://zapgrafica.com.br/servico/detalhe/linha-de-atacado/displays/display-de-mesa-em-l-com-porta-folheto-/acrilico-transparente-2mm/150x210mm/DPLS1C1',
        'https://zapgrafica.com.br/servico/detalhe/linha-de-atacado/wind-banner/pecas/base/WBBASE',
        'https://zapgrafica.com.br/servico/detalhe/linha-de-atacado/canecas-copos-e-tacas/canecas-de-porcelana/simples-325ml/branca/CPB01C1',
    ],
}

KNOWN_IMAGES = {
    'giv': [
        'https://wbl.blob.core.windows.net/cdn/132/1-bloco-com-100-folhas-105x148mm-em-sulfite-75g-1x0-sem-enobrecimento-blocagem-com-100-folhas-serrilha-grampo-412679.webp'
    ]
}

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'}
BAD_TOKENS = ('logo', 'icon', 'favicon', 'sprite', 'payment', 'visa', 'master', 'elo', 'pix', 'boleto', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'twitter')


def request(url: str, timeout: int = 25):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
    return urllib.request.urlopen(req, timeout=timeout)


class ImageParser(HTMLParser):
    def __init__(self, base: str):
        super().__init__()
        self.base = base
        self.images: list[tuple[str, str]] = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag.lower() == 'img':
            alt = html.unescape(attrs.get('alt', '') or '')
            for key in ('src', 'data-src', 'data-original', 'data-lazy-src', 'data-zoom-image'):
                val = attrs.get(key)
                if val:
                    self._add(val, alt)
            for key in ('srcset', 'data-srcset'):
                val = attrs.get(key)
                if val:
                    for part in val.split(','):
                        self._add(part.strip().split(' ')[0], alt)

    def _add(self, raw: str, alt: str):
        raw = html.unescape(raw.strip())
        if not raw or raw.startswith(('data:', 'blob:', '#')):
            return
        self.images.append((urllib.parse.urljoin(self.base, raw), alt))


def safe_name(value: str) -> str:
    value = urllib.parse.unquote(value)
    value = re.sub(r'[^a-zA-Z0-9._-]+', '-', value).strip('-._')
    return value[:120] or 'image'


def ext_from(content_type: str, url: str) -> str:
    path_ext = Path(urllib.parse.urlparse(url).path).suffix.lower()
    if path_ext in IMAGE_EXTS:
        return path_ext
    typ = (content_type or '').split(';', 1)[0].strip().lower()
    mapping = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif'}
    return mapping.get(typ) or mimetypes.guess_extension(typ) or '.img'


def likely_reference(url: str, alt: str) -> bool:
    s = f'{url} {alt}'.lower()
    if any(token in s for token in BAD_TOKENS):
        return False
    return True


def collect_page(source: str, page_url: str, candidates: dict[str, dict]):
    try:
        with request(page_url) as res:
            final_url = res.geturl()
            raw = res.read(4_000_000)
            charset = res.headers.get_content_charset() or 'utf-8'
        text = raw.decode(charset, errors='replace')
        parser = ImageParser(final_url)
        parser.feed(text)
        for url, alt in parser.images:
            if likely_reference(url, alt):
                candidates.setdefault(url, {'source': source, 'source_page': page_url, 'alt': alt})
        for match in re.finditer(r'background(?:-image)?\s*:\s*url\(["\']?([^"\')]+)', text, flags=re.I):
            url = urllib.parse.urljoin(final_url, html.unescape(match.group(1)))
            if likely_reference(url, ''):
                candidates.setdefault(url, {'source': source, 'source_page': page_url, 'alt': 'background'})
        print(f'[PAGE] {source}: {page_url} -> {len(parser.images)} img tags')
    except Exception as exc:
        print(f'[WARN] page {page_url}: {type(exc).__name__}: {exc}')


def download(source: str, url: str, meta: dict, index: int):
    try:
        with request(url) as res:
            content_type = res.headers.get('Content-Type', '')
            if not content_type.lower().startswith('image/'):
                return None
            data = res.read(15_000_000)
        if len(data) < MIN_BYTES:
            return None
        digest = hashlib.sha256(data).hexdigest()
        ext = ext_from(content_type, url)
        basename = safe_name(Path(urllib.parse.urlparse(url).path).stem)
        folder = OUT / source
        folder.mkdir(parents=True, exist_ok=True)
        name = f'{index:03d}-{basename[:70]}-{digest[:10]}{ext}'
        path = folder / name
        path.write_bytes(data)
        return {
            'source': source,
            'source_page': meta.get('source_page', ''),
            'image_url': url,
            'alt': meta.get('alt', ''),
            'file': path.as_posix(),
            'bytes': len(data),
            'sha256': digest,
            'content_type': content_type.split(';', 1)[0],
            'usage': 'REFERENCE_ONLY_LICENSE_NOT_VERIFIED',
        }
    except Exception as exc:
        print(f'[WARN] image {url}: {type(exc).__name__}: {exc}')
        return None


def main():
    manifest = []
    for source, pages in SOURCES.items():
        candidates: dict[str, dict] = {}
        for page in pages:
            collect_page(source, page, candidates)
            time.sleep(0.4)
        for url in KNOWN_IMAGES.get(source, []):
            candidates.setdefault(url, {'source': source, 'source_page': 'known-from-reference-page', 'alt': 'produto'})

        print(f'[SOURCE] {source}: {len(candidates)} candidate images')
        saved = 0
        for url, meta in candidates.items():
            if saved >= MAX_PER_SOURCE:
                break
            row = download(source, url, meta, saved + 1)
            if row:
                manifest.append(row)
                saved += 1
                print(f"[OK] {source}: {row['file']} ({row['bytes']} bytes)")
            time.sleep(0.2)
        print(f'[DONE] {source}: {saved} saved')

    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    with (OUT / 'manifest.csv').open('w', newline='', encoding='utf-8-sig') as fh:
        fields = ['source','source_page','image_url','alt','file','bytes','sha256','content_type','usage']
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(manifest)
    (OUT / 'README.txt').write_text(
        'Central Prints - pacote de imagens de referencia\n\n'
        'Origem: Atual Card, GIV Online e Zap Grafica, conforme URLs fornecidas pelo usuario.\n'
        'Finalidade: pesquisa visual e funcional interna.\n'
        'ATENCAO: direitos/licencas das imagens nao foram verificados. Nao publicar ou reutilizar comercialmente sem autorizacao/licenca.\n'
        'Veja manifest.csv e manifest.json para URL e pagina de origem de cada arquivo.\n',
        encoding='utf-8'
    )
    if not manifest:
        raise SystemExit('Nenhuma imagem de referencia foi baixada.')
    print(f'TOTAL_SAVED={len(manifest)}')


if __name__ == '__main__':
    main()
