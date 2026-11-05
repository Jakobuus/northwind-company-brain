# People and expertise

`brain.people.profile(brain, viewer, person_id)` returns a policy person's identity, declared expertise,
activity topics, and collaborators. `who_knows(brain, viewer, topic, k=5)` ranks declared matches and
activity evidence. HTTP uses `/api/person?person=lena&id=raj` and `/api/who?person=lena&q=sales`;
the matching MCP tools are `person(id)` and `who_knows(topic)`.

Declare expertise in `policy.yaml` under `people.<id>.expertise`, or in a person note with
`type: person`, `person: <id>`, and `expertise: [..]`. Person notes can also carry `team` and `role`.
Declarations are public, except declarations in private notes. The shared policy loader does not store
the `expertise` key in its Person type, so this module reads it from `policy.yaml` when requested.

Activity uses only notes the viewer can read: authored notes and meetings listing the person in `allow`.
Subjects and area names receive a base weight; distinctive title and body terms receive a simple TF-IDF
weight across the viewer's readable notes. Each topic lists the readable note IDs that support it.
Collaborators are coauthors or meeting coattendees on readable, nonprivate notes. A private note can
contribute to its author's own activity, but never to another viewer's activity or collaborators.

Pass `people=True` to `brain.graph.export` or `people=1` to `/api/graph` for person nodes placed at
their home areas, attendee edges, and reciprocal collaborator edges. Existing default graph output is
unchanged. Policy identities remain public; meeting and collaboration edges come only from readable notes.
