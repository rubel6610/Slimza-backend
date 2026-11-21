"""Convert slimza.com /api/blogs JSON into Markdown seed records."""
import html, json, re, sys

src, out = sys.argv[1], sys.argv[2]
data = json.load(open(src))["data"]

CATEGORY_BY_KEYWORD = [
    ("bundle", "product-guides"),
    ("coffee", "product-guides"),
    ("matcha", "nutrition"),
    ("shilajit", "natural-ingredients"),
    ("tea", "wellness-tips"),
    ("elixir", "wellness-tips"),
]

def category_for(title):
    t = title.lower()
    for key, cat in CATEGORY_BY_KEYWORD:
        if key in t:
            return cat
    return "wellness-tips"

def clean(text):
    text = html.unescape(text).replace(" ", " ").replace("\r", "")
    return re.sub(r"[ \t]+", " ", text).strip()

def looks_like_heading(line):
    if len(line) > 80 or line.endswith((".", ",", ";", ":", "!", "?")) and not line.endswith("?"):
        return False
    return len(line.split()) <= 12 and not line.startswith(("-", "*", ">", "#"))

def html_to_markdown(body):
    body = body.replace("\r", "")
    if "<p" not in body:
        return clean_md(body)
    parts = re.findall(r"<p[^>]*>(.*?)</p>", body, flags=re.S)
    lines = []
    for part in parts:
        part = re.sub(r"<br\s*/?>", "\n", part)
        part = re.sub(r"<(strong|b)>(.*?)</\1>", r"**\2**", part)
        part = re.sub(r"<[^>]+>", "", part)
        for line in clean(part).split("\n"):
            line = line.strip()
            if line:
                lines.append(line)
    md = []
    for i, line in enumerate(lines):
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if re.match(r"^\d+\.\s", line) and len(line) < 90 and nxt and not re.match(r"^\d+\.\s", nxt):
            md.append(f"### {line}")
        elif looks_like_heading(line) and nxt and (i > 0 or line.endswith("?")):
            md.append(f"## {line}")
        else:
            md.append(line)
    return "\n\n".join(md)

def clean_md(body):
    text = html.unescape(body).replace(" ", " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def slugify(title):
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return s[:120].rstrip("-")

records = []
for b in sorted(data, key=lambda x: x["publish_date"], reverse=True):
    excerpt = clean(b["short_description"] or "")
    first_para = excerpt.split("\n\n")
    # Some short descriptions repeat the title line first; keep a readable 1–2 sentence excerpt.
    excerpt_lines = [l for l in excerpt.split("\n") if l.strip()]
    if len(excerpt_lines) > 1 and len(excerpt_lines[0]) < 90:
        excerpt_text = " ".join(excerpt_lines[1:])
    else:
        excerpt_text = " ".join(excerpt_lines)
    content_md = html_to_markdown(b["description"] or "")
    if len(excerpt_text) < 120:
        # The short description is only a subtitle: use the article's first paragraph.
        for para in content_md.split("\n\n"):
            para = para.strip()
            if para and not para.startswith(("#", "-", "*", ">", "---")) and len(para) > 80:
                excerpt_text = re.sub(r"\*\*(.+?)\*\*", r"\1", para)
                break
    if len(excerpt_text) > 280:
        cut = excerpt_text[:280]
        excerpt_text = cut[: cut.rfind(" ")].rstrip(",;:") + "…"
    records.append({
        "slug": slugify(b["title"]),
        "title": clean(b["title"]),
        "excerpt": excerpt_text or clean(b["title"]),
        "content": content_md,
        "image": b["image"],
        "author": re.sub(r"\s+", " ", (b.get("author") or "Slimza").strip()) or "Slimza",
        "category": category_for(b["title"]),
        "publishedAt": b["publish_date"],
        "sourceId": b["id"],
    })

json.dump(records, open(out, "w"), ensure_ascii=False, indent=2)
for r in records:
    print(r["publishedAt"], r["category"], r["slug"], "| excerpt", len(r["excerpt"]), "| md", len(r["content"]))
