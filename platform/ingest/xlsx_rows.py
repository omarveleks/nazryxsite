"""Read every sheet of an .xlsx file straight from its XML: {sheet name: [[cell text]]}.

Some registry exports write cell references Excel tolerates but openpyxl rejects ('1:1'); reading the XML directly
keeps every row. Values come back as text, exactly as stored."""
import re
import zipfile

from lxml import etree
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

def col_index(ref):
    m = re.match(r'([A-Z]+)', ref or '')
    if not m: return None
    n = 0
    for ch in m.group(1): n = n * 26 + ord(ch) - 64
    return n - 1

def rows(path, limit=None):
    z = zipfile.ZipFile(path)
    names = z.namelist()
    ss = []
    if 'xl/sharedStrings.xml' in names:
        for si in etree.fromstring(z.read('xl/sharedStrings.xml')).iterfind('m:si', NS):
            ss.append(''.join(si.itertext()))
    wb = etree.fromstring(z.read('xl/workbook.xml'))
    rels = etree.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    target = {r.get('Id'): r.get('Target') for r in rels}
    out = {}
    for s in wb.iterfind('.//m:sheet', NS):
        t = target[s.get(RID)].lstrip('/')
        p = t if t.startswith('xl/') else 'xl/' + t
        data = []
        for _, row in etree.iterparse(z.open(p), tag='{%s}row' % NS['m']):
            cells = []
            for c in row.iterfind('m:c', NS):
                i = col_index(c.get('r'))
                v = c.find('m:v', NS); isv = c.find('m:is', NS)
                if c.get('t') == 's' and v is not None: val = ss[int(v.text)]
                elif isv is not None: val = ''.join(isv.itertext())
                else: val = v.text if v is not None else ''
                if i is None or i < len(cells): i = len(cells)
                cells += [''] * (i - len(cells)); cells.append((val or '').strip())
            data.append(cells); row.clear()
            if limit and len(data) >= limit: break
        out[s.get('name')] = data
    return out
