/**
 * 口语情景库：日常生活的真实场合，按主题分组。
 *
 * 每个场景只描述三件事——AI 演谁（role）、我要办成什么（goal）、难度（level）。
 * 具体的台词、剧情走向交给模型现场发挥，同一个场景每次聊都不一样。
 */

import type { TalkLevel } from '../types';

export type { TalkLevel };

export interface TalkScene {
  id: string;
  /** 场景名（中文，展示用） */
  name: string;
  icon: string;
  /** AI 扮演谁（中文，展示用） */
  partner: string;
  /** 给模型的人设：英文、具体到身份和脾气 */
  role: string;
  /** 我要办成的事（中文，展示用；同时提示模型把对话往这个方向推） */
  goal: string;
  level: TalkLevel;
}

export interface TalkGroup {
  key: string;
  name: string;
  icon: string;
  scenes: TalkScene[];
}

export const TALK_LEVELS: { key: TalkLevel; label: string; hint: string }[] = [
  { key: 'easy', label: '轻松', hint: '对方说得慢、句子短，词汇基础' },
  { key: 'medium', label: '日常', hint: '正常语速，真实生活用语' },
  { key: 'hard', label: '真实', hint: '有省略、俚语、口音感，偶尔抢话' },
];

export const TALK_GROUPS: TalkGroup[] = [
  {
    key: 'daily',
    name: '日常起居',
    icon: '☕',
    scenes: [
      {
        id: 'cafe',
        name: '咖啡店点单',
        icon: '☕',
        partner: '咖啡店员',
        role: 'a friendly but rushed barista at a busy downtown coffee shop. Some items are sold out today.',
        goal: '点一杯喝的，发现想点的没了要换，最后改成外带',
        level: 'easy',
      },
      {
        id: 'return',
        name: '超市退货',
        icon: '🧾',
        partner: '客服台员工',
        role: 'a customer service desk employee who follows store policy strictly. You need a receipt and the original packaging.',
        goal: '把上周买的有问题的东西退掉或者换一个',
        level: 'medium',
      },
      {
        id: 'barber',
        name: '理发店',
        icon: '✂️',
        partner: '理发师',
        role: 'a chatty barber who keeps mishearing what you want and starts cutting too short.',
        goal: '说清楚想要什么发型，发现对方理解错了要当场纠正',
        level: 'medium',
      },
      {
        id: 'laundry',
        name: '洗衣店送洗',
        icon: '👔',
        partner: '洗衣店老板',
        role: 'the owner of a small dry cleaner. You are worried about a stain and want it done before a specific day.',
        goal: '送洗一件有污渍的衣服，问清价格和取件时间',
        level: 'easy',
      },
      {
        id: 'neighbor',
        name: '邻居太吵',
        icon: '🔊',
        partner: '隔壁邻居',
        role: 'a neighbor who has been playing loud music late at night and does not realize it is a problem.',
        goal: '客气但明确地让对方晚上小声一点，又不把关系搞僵',
        level: 'hard',
      },
      {
        id: 'parcel',
        name: '快递丢了',
        icon: '📦',
        partner: '快递客服',
        role: 'a phone support agent for a parcel company. You have to give the tracking number and describe what went wrong.',
        goal: '查一个显示已签收但没收到的包裹，要求处理',
        level: 'medium',
      },
    ],
  },
  {
    key: 'home',
    name: '住房出行',
    icon: '🏠',
    scenes: [
      {
        id: 'viewing',
        name: '看房',
        icon: '🏠',
        partner: '房产中介',
        role: 'a letting agent showing you a flat. He is upbeat and tries to play down the problems of the place.',
        goal: '问清租金、押金、水电费谁付，什么时候能搬进来',
        level: 'medium',
      },
      {
        id: 'repair',
        name: '房东报修',
        icon: '🔧',
        partner: '房东',
        role: 'a landlord who is polite but slow to act and would rather you fix it yourself.',
        goal: '热水器坏了三天，要求尽快修好或者给个明确时间',
        level: 'hard',
      },
      {
        id: 'taxi',
        name: '打车',
        icon: '🚕',
        partner: '出租车司机',
        role: 'a taxi driver who talks a lot, takes a route you are not sure about, and only takes cash.',
        goal: '说清目的地，发现绕路要问，最后付钱找零',
        level: 'easy',
      },
      {
        id: 'airport',
        name: '机场值机',
        icon: '✈️',
        partner: '值机柜台人员',
        role: 'an airline check-in agent. Your bag is over the weight limit and the flight is boarding soon.',
        goal: '办托运，处理行李超重，争取一个靠窗座位',
        level: 'medium',
      },
      {
        id: 'hotel',
        name: '酒店入住',
        icon: '🏨',
        partner: '前台接待',
        role: 'a hotel receptionist. The room you booked turns out to have a problem and the hotel is almost full.',
        goal: '办理入住，发现房间有问题，要求换房或补偿',
        level: 'medium',
      },
      {
        id: 'direction',
        name: '街头问路',
        icon: '🗺️',
        partner: '路人',
        role: 'a local passer-by who gives directions fast, with landmarks and hand gestures. You may need to ask again.',
        goal: '找到某个地方，听不清就再确认一遍路线',
        level: 'hard',
      },
    ],
  },
  {
    key: 'work',
    name: '工作职场',
    icon: '💼',
    scenes: [
      {
        id: 'interview',
        name: '求职面试',
        icon: '💼',
        partner: '面试官',
        role: 'a hiring manager conducting a 20-minute interview. You ask behavioral questions and follow-up questions.',
        goal: '用英文做自我介绍，回答两三个行为面试问题',
        level: 'hard',
      },
      {
        id: 'firstday',
        name: '入职第一天',
        icon: '🪪',
        partner: '带你的同事',
        role: 'a colleague showing a new hire around the office. Friendly, gives you a lot of information at once.',
        goal: '认识同事，问清日常流程、午饭、打卡这些事',
        level: 'medium',
      },
      {
        id: 'raise',
        name: '谈加薪',
        icon: '📈',
        partner: '你的主管',
        role: 'your direct manager. You are supportive but constrained by budget and want concrete evidence.',
        goal: '提出加薪，用具体成果支撑，争取一个明确答复',
        level: 'hard',
      },
      {
        id: 'handover',
        name: '工作交接',
        icon: '📋',
        partner: '交接的同事',
        role: 'a colleague handing over a project in a hurry before going on leave. He keeps saying "it is all in the doc".',
        goal: '把交接的细节问清楚，尤其是截止时间和负责人',
        level: 'hard',
      },
      {
        id: 'delay',
        name: '项目延期汇报',
        icon: '⏰',
        partner: '客户',
        role: 'a client waiting for a delayed deliverable. You are not happy but open to a new timeline.',
        goal: '说明延期的原因，给出新的时间表，稳住对方',
        level: 'hard',
      },
      {
        id: 'meeting',
        name: '会上提反对意见',
        icon: '🗣️',
        partner: '会议主持人',
        role: 'a meeting host moving fast through the agenda. You need to cut in politely to disagree.',
        goal: '礼貌地打断，提出不同看法，并给出理由',
        level: 'hard',
      },
    ],
  },
  {
    key: 'money',
    name: '钱与人情',
    icon: '💰',
    scenes: [
      {
        id: 'borrow',
        name: '向朋友借钱',
        icon: '🙏',
        partner: '朋友',
        role: 'a close friend who is willing to help but wants to know why and when you will pay it back.',
        goal: '开口借一笔钱，说清用途和还款时间',
        level: 'medium',
      },
      {
        id: 'lend',
        name: '催人还钱',
        icon: '💸',
        partner: '欠钱的朋友',
        role: 'a friend who borrowed money months ago and keeps changing the subject whenever it comes up.',
        goal: '不撕破脸地把钱要回来，问清什么时候还',
        level: 'hard',
      },
      {
        id: 'split',
        name: 'AA 结账',
        icon: '🍽️',
        partner: '一起吃饭的朋友',
        role: 'a friend at dinner who suggests splitting the bill evenly even though you ordered much less.',
        goal: '把账算清楚，又不显得小气',
        level: 'medium',
      },
      {
        id: 'bargain',
        name: '市场砍价',
        icon: '🏷️',
        partner: '摊主',
        role: 'a market vendor who enjoys haggling and pretends to be offended by your first offer.',
        goal: '把价格砍下来，最好还多要点东西',
        level: 'medium',
      },
      {
        id: 'roommate',
        name: '合租分摊账单',
        icon: '🧮',
        partner: '室友',
        role: 'a roommate who uses much more electricity and water than you but wants to split everything 50/50.',
        goal: '谈一个更公平的分摊方式，别吵起来',
        level: 'hard',
      },
      {
        id: 'refuse',
        name: '拒绝推销办卡',
        icon: '🚫',
        partner: '推销员',
        role: 'an aggressive salesperson trying to sign you up for a membership card with a "today only" discount.',
        goal: '坚定但礼貌地拒绝，不被绕进去',
        level: 'medium',
      },
    ],
  },
  {
    key: 'social',
    name: '社交健身',
    icon: '🤝',
    scenes: [
      {
        id: 'gym',
        name: '健身房办卡',
        icon: '🏋️',
        partner: '会籍顾问',
        role: 'a gym membership consultant who pushes personal training packages on top of the membership.',
        goal: '问清价格和合同期限，只要会员不要私教课',
        level: 'medium',
      },
      {
        id: 'gymclass',
        name: '第一次上团课',
        icon: '🤸',
        partner: '健身教练',
        role: 'a fitness instructor running a group class. You are new and do not know the movements.',
        goal: '问清动作怎么做、器械在哪，跟上课程',
        level: 'easy',
      },
      {
        id: 'invite',
        name: '约朋友周末',
        icon: '📅',
        partner: '朋友',
        role: 'a friend who keeps saying "maybe" and never commits to a plan.',
        goal: '把周末的安排定下来，具体到时间和地点',
        level: 'medium',
      },
      {
        id: 'decline',
        name: '婉拒邀请',
        icon: '🙅',
        partner: '邀请你的朋友',
        role: 'a friend excitedly inviting you to a party you really do not want to attend.',
        goal: '拒绝但不伤感情，给出一个说得过去的理由',
        level: 'hard',
      },
      {
        id: 'party',
        name: '聚会上搭话',
        icon: '🥂',
        partner: '陌生人',
        role: 'a stranger at a friend-of-a-friend party. You know nobody there. Friendly but a bit reserved at first.',
        goal: '主动开口认识对方，把 small talk 聊下去',
        level: 'hard',
      },
      {
        id: 'comfort',
        name: '安慰失恋的朋友',
        icon: '🫂',
        partner: '刚失恋的朋友',
        role: 'a friend who just broke up and is upset, half talking and half venting.',
        goal: '倾听并回应，别说教，让对方好受一点',
        level: 'hard',
      },
    ],
  },
  {
    key: 'campus',
    name: '校园学习',
    icon: '🎓',
    scenes: [
      {
        id: 'groupwork',
        name: '小组作业分工',
        icon: '👥',
        partner: '组员',
        role: 'a group member who has done very little work but talks as if he contributed equally.',
        goal: '把分工重新定清楚，让进度推得动',
        level: 'hard',
      },
      {
        id: 'advisor',
        name: '找导师谈论文',
        icon: '📚',
        partner: '导师',
        role: 'a thesis supervisor who is demanding and asks sharp questions about your research design.',
        goal: '说明你的研究方向，回答质疑，争取到明确建议',
        level: 'hard',
      },
      {
        id: 'library',
        name: '图书馆借书',
        icon: '📖',
        partner: '图书管理员',
        role: 'a librarian at the front desk. The book you need is checked out and there is a waitlist.',
        goal: '借书或者续借，书被借走了就问预约的办法',
        level: 'easy',
      },
      {
        id: 'fail',
        name: '挂科找老师',
        icon: '📉',
        partner: '任课老师',
        role: 'a course instructor whose office hours are nearly over. You failed the exam and want to know your options.',
        goal: '问清补考、重修或者加分作业的可能性',
        level: 'medium',
      },
      {
        id: 'speakup',
        name: '课堂发言',
        icon: '🙋',
        partner: '课堂主持人',
        role: 'a seminar host steering a class discussion you have opinions about.',
        goal: '举手发言，表达一个和主流不同的观点并举例',
        level: 'hard',
      },
    ],
  },
];

/** 全部场景平铺，便于按 id 查 */
export const ALL_SCENES: TalkScene[] = TALK_GROUPS.flatMap((g) => g.scenes);

/**
 * 随机变数：每局从中抽一两个塞给模型。
 *
 * 场景的 role / goal 是固定的，光靠它模型很容易每次都写出一模一样的
 * 「教科书对话」。加上变数之后，同一个场景每次的走向、对方的态度、
 * 遇到的小麻烦都不一样——练的是临场反应，不是背台词。
 */
export const TALK_TWISTS = [
  '对方今天很赶时间，一直想快点结束，说话短、节奏快。',
  '对方一开始把你的意思理解错了，你需要澄清一次才回到正轨。',
  '中途有第三个人插进来说了一句话，然后离开。',
  '对方给的条件比你预期的差（价格、时间、态度），需要你争取。',
  '中间出现一个小意外：东西坏了／系统出问题／要找的东西找不到，节奏被打断。',
  '对方心不在焉，有一句没听清，需要你重复。',
  '对方试图把责任推给你，你要把话说清楚但不撕破脸。',
  '对方给了一个你没想到的替代方案，需要你当场判断要不要接受。',
  '你手里的信息不全（单号、地址、日期记不清），得边聊边想。',
  '对方突然问了一个和正事无关的问题，气氛缓和了一下。',
];

/** 对方性格：每局随机，避免同一个人每次都是同一个脾气 */
export const TALK_PERSONAS = [
  '公事公办，话少，只回答必要的部分。',
  '热情过头，爱聊天，会主动分享自己的事。',
  '有点不耐烦，情绪写在语气里。',
  '爱开玩笑，语气随意，会用俚语。',
  '谨慎小心，什么细节都要跟你确认一遍。',
  '语速偏快，习惯用省略句和口头语（gonna / yeah / like）。',
];

/** 随机抽 n 个不重复的元素 */
export function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

/** 一局对话的随机设定 */
export interface TalkVariation {
  persona: string;
  twists: string[];
}

export function rollVariation(): TalkVariation {
  return {
    persona: sample(TALK_PERSONAS, 1)[0],
    twists: sample(TALK_TWISTS, 1 + Math.floor(Math.random() * 2)),
  };
}

export function findScene(id: string): TalkScene | undefined {
  return ALL_SCENES.find((s) => s.id === id);
}

/** 场景属于哪个分组 */
export function groupOf(sceneId: string): TalkGroup | undefined {
  return TALK_GROUPS.find((g) => g.scenes.some((s) => s.id === sceneId));
}
