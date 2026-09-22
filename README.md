# naming-things

Describe one property in plain English. Ten candidate names come back. A plain
LLM and TypeSafe Jev each pick the name they would ship, and you see whether
they agree.

Try it: <https://who.github.io/naming-things/>

Press Randomize for a fresh brief, then Run. A whole run takes a few seconds.

## What you are looking at

Naming a field is a small judgement call that nobody makes the same way twice.
This page puts the same ten names in front of two judges and shows both answers
beside each other.

```text
        one property, described in prose
                      |
              ten candidate names
                 /            \
          plain LLM            Jev
                 \            /
              AGREE or DISAGREE
```

They agree more often than I expected. When they split, it is usually over
whether the unit belongs in the key, `weight` against `weightGrams`. Jev also
reports how sure it is and how the rest of its confidence was spread, so a close
call reads as a close call instead of a verdict. It is also the quicker of the
two most days, and each judge's badge counts up while it waits, so you can watch
that happen rather than take my word for it.

## Steering the second pick

The style controls under the description box say how you want names written:
camelCase or snake_case, a leaning toward domain nouns or `isX` booleans, and
how much weight to put on short names, explicit units and nullability. Those
preferences ride along with the question to Jev. Turn explicit units up and
press Re-ask Jev. The ten names stay where they are, and only the Jev pick can
move.

## The fine print

Every run is a live run. Nothing on the page is filled in from a canned answer,
and a call that will not answer says how it failed instead of showing a name no
model wrote. One property per run. Both judges can disagree with each other, and
both can disagree with you.
