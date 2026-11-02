export const resources = [
  {
    slug: 'a-quiet-beginning', title: 'A quiet beginning', category: 'Faith', type: 'Reflection', minutes: 3,
    description: 'A small pause for scripture, gratitude, and prayer before the day begins.',
    introduction: 'You don’t need a perfect morning to make room for God. A few unhurried minutes can help you turn your attention toward the people and work in front of you.',
    scripture: 'Psalm 23',
    steps: [
      ['Find a moment', 'Set down your phone, take a breath, and find a comfortable place. If the house is already busy, let this be a pause within the noise.'],
      ['Read and notice', 'Read Psalm 23 slowly. Choose one word or phrase to carry with you. What does it help you remember about God’s care?'],
      ['Name a gift', 'Write down one thing you are thankful for, however ordinary. It might be a meal, a conversation, or another chance to begin.'],
      ['Pray by name', 'Pray for each person in your household. Ask for patience, wisdom, and opportunities to show love in practical ways.'],
    ],
    prompts: ['One word or phrase I want to remember:', 'Something I am grateful for:', 'The people I am praying for:', 'One small act of love for today:'],
  },
  {
    slug: 'a-gentle-home-reset', title: 'A gentle home reset', category: 'Home', type: 'Checklist', minutes: 4,
    description: 'A manageable reset for the days when everything feels a little scattered.',
    introduction: 'The goal is a home that supports the people living in it. Choose what would make today easier, and let a small amount of progress be enough.',
    steps: [
      ['Choose one surface', 'Clear a table, counter, or corner that your family uses often. Put away what has a home and gather the rest in one basket to sort later.'],
      ['Move one task forward', 'Start a load of laundry, wash the breakfast dishes, or empty a bin. Choose one task rather than trying to catch up on everything at once.'],
      ['Make a simple meal decision', 'Decide what is realistic for dinner using what you have. Write down anything you need so the decision doesn’t keep taking your attention.'],
      ['Share the work', 'Invite each child to choose one age-appropriate task. Explain what finished looks like, help as needed, and notice the effort.'],
      ['Stop and enjoy the difference', 'Take a moment to use the space you cleared. The rest can wait for another reset.'],
    ],
    prompts: ['The one space I am resetting:', '[ ] Clear one surface', '[ ] Move one household task forward', '[ ] Decide on a simple meal', '[ ] Invite the family to help', 'Something I can leave for another day:'],
  },
  {
    slug: 'a-family-prayer-rhythm', title: 'A family prayer rhythm', category: 'Family', type: 'Guide', minutes: 4,
    description: 'Make prayer part of a moment your family already shares.',
    introduction: 'Family prayer can be brief, honest, and welcoming. Start with a familiar part of the day and make space for everyone to participate in a way that feels comfortable.',
    scripture: 'Philippians 4:6–7',
    steps: [
      ['Choose an existing moment', 'Breakfast, a school journey, or bedtime can become a reminder. Choose a time that fits your household rather than adding another demanding routine.'],
      ['Begin with thanks', 'Invite each person to name something good from the day. Young children might point to something or ask an adult to speak for them.'],
      ['Bring one concern', 'Ask who or what the family would like to pray for. Keep sharing optional and listen without rushing to offer an answer.'],
      ['Keep it simple', 'An adult or willing child can lead a short prayer. Thank God, bring the concerns you shared, and ask for help to care for one another.'],
      ['Begin again when needed', 'If you miss a day, pick up at the next natural moment. A rhythm grows through returning, not through getting every day right.'],
    ],
    prompts: ['The moment we will use:', 'Something we are thankful for:', 'Someone we want to pray for:', 'A practical way we can care for that person:'],
  },
  {
    slug: 'a-week-with-intention', title: 'A week with intention', category: 'Home', type: 'Planner', minutes: 5,
    description: 'See what matters this week and leave room for the unexpected.',
    introduction: 'A useful plan leaves room for real life. Gather the commitments you already know about, choose a few priorities, and make space for rest and connection.',
    steps: [
      ['Gather your commitments', 'List appointments, school activities, work, and ministry commitments in one place. Check the plan with anyone who shares those responsibilities.'],
      ['Choose three priorities', 'Ask what would make the biggest difference this week. Include caring for people alongside household tasks.'],
      ['Plan a few dependable meals', 'Use familiar meals on busy days. Leave space for leftovers or changes instead of filling every evening with a new idea.'],
      ['Protect an open moment', 'Choose a time with fewer demands: an evening walk, a shared meal, or a quiet hour. Resist filling every gap.'],
    ],
    prompts: ['This week’s three priorities:', '1.', '2.', '3.', 'Monday:', 'Tuesday:', 'Wednesday:', 'Thursday:', 'Friday:', 'Saturday:', 'Sunday:', 'A moment for rest or connection:', 'Something to ask for help with:'],
  },
  {
    slug: 'around-the-table', title: 'Around the table', category: 'Family', type: 'Conversation', minutes: 3,
    description: 'Simple conversation starters for an everyday family meal.',
    introduction: 'Meaningful conversation often starts with a small question and someone willing to listen. Use one prompt at a meal, on a walk, or while doing a task together.',
    steps: [
      ['Give everyone room', 'Invite answers without requiring a turn. Some people need time to think, and some share more easily later.'],
      ['Ask one question', 'What made you smile today? Was anything difficult? Who helped you? Who could use a kind word? Choose one rather than working through a whole list.'],
      ['Listen with curiosity', 'Try a gentle follow-up such as “Tell me more about that.” Let the conversation be about understanding each other.'],
      ['Choose a small response', 'If someone needs encouragement or practical help, decide together what one small act of care could look like.'],
    ],
    prompts: ['Something that made me smile:', 'Something that was difficult:', 'Someone who helped me:', 'Someone I could encourage:', 'A question we would like to ask next time:'],
  },
  {
    slug: 'an-evening-exhale', title: 'An evening exhale', category: 'Faith', type: 'Reflection', minutes: 3,
    description: 'A gentle way to reflect, give thanks, and release an unfinished day.',
    introduction: 'Some days end with unfinished tasks and complicated feelings. This short reflection makes room to notice what happened and bring it honestly to God.',
    scripture: 'Matthew 11:28–30',
    steps: [
      ['Notice the day', 'Recall one meaningful moment and one difficult moment. You can write a sentence about each without needing to make the day sound better than it felt.'],
      ['Offer thanks', 'Name a kindness, a provision, or a small joy. If it involved someone else, consider telling them tomorrow.'],
      ['Release what is unfinished', 'Write down a task or concern you keep returning to. If it needs action tomorrow, note the next small step and put the list aside.'],
      ['Close with prayer', 'Read Matthew 11:28–30 and pray in your own words. Ask for rest and the grace to begin again.'],
    ],
    prompts: ['A moment I want to remember:', 'A difficult part of today:', 'Something I am grateful for:', 'What I am releasing for tonight:', 'One small step for tomorrow:'],
  },
];

export function downloadWorksheet(resource) {
  const text = `GODLY HOMES\n${resource.title}\n${'='.repeat(resource.title.length)}\n\n${resource.description}\n\n${resource.prompts.map(prompt => `${prompt}\n\n________________________________________________\n`).join('\n')}\nFor personal and household use.\nhttps://godlyhomes.com/resources/${resource.slug}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${resource.slug}-worksheet.txt`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
