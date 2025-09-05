"""
footballguys_adp_scrape.py

Scrapes the Footballguys ADP table and writes it to CSV.
- Works with either a live URL or a saved HTML file.
- Targets the table under <div id="ADP_Component_ADPTable">.
- Extracts headers from <thead> and rows from <tbody>.
- Attempts to include player link / slug (if present).

Usage:
  python footballguys_adp_scrape.py --url "https://www.footballguys.com/adp?season=2025&pos=wr" -o wr_adp_2025.csv
  python footballguys_adp_scrape.py --html fbgsample.html -o wr_adp_2025.csv
"""

import argparse
from pathlib import Path
import sys
import pandas as pd
from bs4 import BeautifulSoup

def parse_table_to_df(html_text: str) -> pd.DataFrame:
    soup = BeautifulSoup(html_text, "html.parser")

    # Prefer the specific container, then fall back to any rankings table
    container = soup.find("div", id="ADP_Component_ADPTable")
    table = container.find("table") if container else None
    if not table:
        table = soup.find("table", class_="rankings-table")
    if not table:
        raise RuntimeError("Could not find the ADP table in the provided HTML.")

    # Headers
    thead = table.find("thead")
    if thead:
        headers = [th.get_text(strip=True) for th in thead.find_all("th")]
    else:
        first_tr = table.find("tr")
        headers = [td.get_text(strip=True) for td in first_tr.find_all(["th","td"])]

    # Rows
    tbody = table.find("tbody")
    trs = tbody.find_all("tr") if tbody else table.find_all("tr")[1:]
    data_rows = []
    for tr in trs:
        tds = tr.find_all("td")
        if not tds:
            continue
        row = [td.get_text(strip=True) for td in tds]
        # Normalize row length to headers
        if len(row) < len(headers):
            row += [""] * (len(headers) - len(row))
        elif len(row) > len(headers):
            row = row[:len(headers)]
        data_rows.append(row)

    df = pd.DataFrame(data_rows, columns=headers)

    # Enrich with player link / slug / id if available
    player_cols = [i for i, h in enumerate(df.columns) if h.lower().startswith("player")]
    if player_cols and trs:
        pidx = player_cols[0]
        links, slugs, ids = [], [], []
        for tr in trs:
            cells = tr.find_all("td")
            td = cells[pidx] if len(cells) > pidx else None
            a = td.find("a") if td else None
            href = a.get("href") if a else ""
            links.append(href or "")

            # Try to pull a slug-ish ending from the URL
            slug = ""
            if href:
                parts = href.strip("/").split("/")
                if parts:
                    slug = parts[-1]
            slugs.append(slug)

            # Look for any embedded data-* id attributes
            pid = ""
            if td:
                for attr in ("data-player-id", "data-playerid", "data-id"):
                    if td.has_attr(attr):
                        pid = td[attr]
                        break
            ids.append(pid)

        df.insert(pidx + 1, "Player Link", links)
        df.insert(pidx + 2, "Player Slug/ID", slugs if any(slugs) else ids)

    return df

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="Footballguys ADP page URL (e.g., ?season=2025&pos=rb)")
    ap.add_argument("--html", help="Path to saved HTML file to parse")
    ap.add_argument("-o", "--out", default="adp.csv", help="Output CSV path")
    args = ap.parse_args()

    if not args.url and not args.html:
        ap.error("Provide either --url or --html")

    if args.url:
        import requests
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Scraper/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }
        r = requests.get(args.url, headers=headers, timeout=30)
        r.raise_for_status()
        html_text = r.text
    else:
        p = Path(args.html)
        if not p.exists():
            sys.exit(f"File not found: {p}")
        html_text = p.read_text(encoding="utf-8", errors="ignore")

    df = parse_table_to_df(html_text)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"Wrote {len(df):,} rows to {args.out}")

if __name__ == "__main__":
    main()
