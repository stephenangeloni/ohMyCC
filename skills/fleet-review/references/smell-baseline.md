# The smell baseline

The fallback standards the `standards` review angle carries when a repo documents none of
its own. Twelve code smells from Fowler's _Refactoring_ (ch. 3), each written **what it is →
how to fix**, scoped to what a diff can actually show.

Two rules bind the whole list:

- **The repo overrides.** A documented repo standard always wins. Where the repo endorses
  something the baseline would flag, suppress the smell and say which document overrode it.
- **Always a judgement call.** Every entry is a labelled heuristic ("possible Feature Envy"),
  never a hard violation. Only a breach of a *documented* repo standard may be reported as
  hard. Skip anything tooling already enforces — a linter finding is not a review finding.

## The twelve

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does
  or holds. → Rename it. If no honest name comes, the design is murky and the naming problem
  is the smaller half of the finding.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the
  change. → Extract the shared shape; call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. →
  Move the method onto the data it envies.
- **Data Clumps** — the same few fields or parameters keep travelling together (a type
  wanting to be born). → Bundle them into one type and pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that
  deserves its own type. → Give the concept its own small type.
- **Repeated Switches** — the same `switch` / `if`-cascade on the same type recurs across the
  change. → Replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the
  diff. → Gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → Split
  so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec
  doesn't have. → Delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → Hide
  the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → Cut it; call the
  real target directly.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it
  inherits. → Drop the inheritance; use composition.

## Reporting shape

For each finding: name the smell, quote the hunk, and say whether it is a **hard violation**
(a documented repo standard is breached — cite the document and the rule) or a **judgement
call** (a baseline smell). Never report a baseline smell as hard.
