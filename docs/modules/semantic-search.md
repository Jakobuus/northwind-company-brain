# Semantic search

The embedding index splits each note at Markdown headings, then into chunks of about 800 characters with a short overlap. It stores chunk vectors, snippets, and a content-hash manifest under `<data root>/.brain-cache/`. Updating the index embeds changed notes and removes deleted ones.

Install the optional dependencies and build the index:

```sh
uv pip install -e ".[embed]"
python -m brain.embed --data path/to/company-data
```

Search uses BM25 until an index exists. When fastembed is installed and the index exists, it combines lexical and semantic ranks. Semantic hits can match without shared words. Every query filters chunks through the current access policy before scoring; private notes remain author-only. Rebuild after changing note contents. Notes changed since the last build are excluded from semantic results until rebuilt.

`BRAIN_EMBED=0` disables semantic search. `BRAIN_MODEL_DIR` sets the fastembed model cache directory (default `~/.cache/brain-fastembed`). The model is `BAAI/bge-small-en-v1.5` and indexing uses batches of 16.
