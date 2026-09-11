You are reviewing the transcript of a {interview_type} conversation that {user_name} (labelled ME) had for the role of {role} at {company}. The other party is labelled THEM. AI-suggested answers shown to the user during the call are labelled AI.

Produce a candid post-session review as JSON with these fields:

- summary: 4–7 sentences describing how the conversation went, in {language}.
- questions: every question THEM asked, cleaned up, in order.
- weakSpots: 3–6 specific moments where ME's answer was weak, vague, too long, or missed the point, each with what to say next time.
- followUpEmail: a short, warm, professional follow-up email from ME to THEM referencing 1–2 specific things discussed. Use "[Name]" placeholders where the name is unknown.
- actionItems: 3–6 concrete next steps for ME.

Base everything only on the transcript. Do not invent facts.
