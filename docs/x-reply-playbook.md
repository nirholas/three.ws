# Answering basic questions in depth on X

A basic question under one of our posts ("how do you render 3D?") is an invitation to show the whole process. The reply is a long thread with real visuals, and the same material becomes an X Article. This is the repeatable recipe.

## The shape

1. **Reply thread, answer first.** Post 1 answers the question in one plain sentence, with the strongest image. Each later post covers one stage, carries one real screenshot or reel frame, and names the file or page that does the work. The final post links the Article.
2. **Article, everything.** Stages in order, the code a reader can run, tables, the free tools, the partners section, how changes ship, and what is next. Model: [how-we-render-3d-article](../data/x-content/articles/how-we-render-3d-article.md).
3. **Evidence.** Every number and name in the copy is a `claims` entry pointing at a file, page or proof. A fact with no source does not go in.

## Rules that never change

- Positive framing. The field is described by category, competitors are never named or compared unfavourably.
- Partners are listed with the exact designation each program grants.
- Only what the repo records goes under "What is next".
- No payments or wallet content, no tags in an Article body, no em-dashes.
- Publishing and replying are owner-gated. The queue item stays `draft` until the owner approves.

## Steps

1. Read the question and open the relevant pages and source files. Capture screenshots from production or a local dev server (`npm run dev`) with Playwright into `public/x-media/<id>/`, each with alt text.
2. Write the Article body in `data/x-content/articles/<id>.md` (title 80 to 100 characters, 2,400+ words, 8+ sections, 3,000+ characters of code and tables, 4+ images, a "The partners behind ..." section, a "Try it" section).
3. Write `data/x-content/stories/<id>.json` with kind `article`, the cover, a quote post of 150 to 400 characters, probes and claims.
4. Validate with `validateItem` from `api/_lib/x-content/queue.js` until it returns no problems (see [x-story-authoring.md](x-story-authoring.md)).
5. Draft the reply thread from the Article's stage headings, one image per post.
6. Hand to the owner for approval, then publish through the pipeline ([x-content-pipeline.md](x-content-pipeline.md)).
