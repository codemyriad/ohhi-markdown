---
title: Sharing and the relay
status: current
date: 2026-10-10
---

# Sharing and the relay

## The short version

1. **Your notes are files on your disk.** Sharing a folder puts a live copy on
   your team's relay and on every device holding a link to it. The rest of
   your vault never leaves your machine.
2. **The relay is your team's, and the app already knows it.** You never type
   its address. If your team runs it on a private network (a company VPN or
   tailnet), shares only work while you are on that network.
3. **A link is the key to one folder.** Make one per person, named for them,
   so you can remove one later. Anyone holding a link can open the folder, and
   the relay holds a copy of what is in it.
4. **To make links you need the team's secret, once per device. To open links
   you need nothing.**
5. **Your own second computer is *Link a device* in Settings.** That link opens
   your whole vault, so it is never for anyone else.

## Share a folder

1. In the file tree, right-click the folder and choose **Share…**. (The
   Shared view's *Share a folder…* asks which folder first.)
2. The share sheet opens. Under *Syncs through*, a card shows the relay the
   folder will use and whether it answers.
3. The first time on this device, it asks for the **Team secret** (see
   [below](#the-teams-secret-and-where-it-lives)). The app checks it as you
   type: it says *works* when it is right, and *doesn’t match this relay*
   when it isn't. The share button stays off until it says *works*.
4. *First link: who is it for?* Type the name of the person the link is for.
   Left empty, it is called *First link*. Add *Your name, shown to them* so
   the link says who sent it.
5. Choose **Share and copy link**. The folder is shared and its first link is
   on your clipboard.
6. **Copy message** gives you the link inside a short sentence, ready to send
   in a chat or an email. **Copy link** gives you the link alone.

Each first share makes a separate, named link for the person you send it
to; your own device keeps its own access. To make more links later, open
**Share…** on the folder again: each link has its own row, with *Copy link*,
*Copy message* and a way to remove it.

## What happens when someone opens the link

A link from a team setup is a web address, `https://<host>/join#editor1:…`.
Clicked, it opens a page on your team's host that says who sent it (the name
they typed), what they get, and whether the relay answers from where they
are. They then choose:

- *In the desktop app*: **Copy link**, then in Oh hi markdown choose
  *Add a folder someone shared with you* and paste it;
- *In this browser*: **Add here**.

The part after `#` never reaches the host: the page reads it in the browser.

When the relay is not served beside the web app (a relay you run yourself,
or a desktop app syncing through a relay other than the team's host), the
link is bare text starting with `editor1:`, and the message says to paste it
into the app with *Add a folder someone shared with you*. See
[Running your own relay](relay.md).

## What the relay is

The relay is a small server that passes edits between the devices sharing a
folder. Each shared folder is a *room* on it. When you are online, your edits
reach the relay and everyone else in the room; when you are offline, you keep
working and everything catches up when you reconnect.

The sync icon in the toolbar tells you where you stand. Green means the relay
has received every edit you made. It does not mean anything more than that:
your own copy on disk is the one that counts.

## Links are links, not people

A share link opens one folder. It is not tied to a person or an account:
whoever holds it can open the folder. That is why you make **one link per
person** (or per device), with a name that says who it is for. Then, if a
laptop is lost or someone leaves, you remove that one link and nobody else
is affected.

A link can carry a name, like "Sam shared *Plans* with you". That is the name
the sender typed, not a verified account. If a link arrives from somewhere
unexpected, ask the person before you add it.

You can make a link **read-only** when you share. A read-only link lets
someone follow along without editing.

Removing a link stops new connections with it. Someone already connected
stays connected until their app reconnects.

## The team's secret, and where it lives

Making links needs **the team's secret** (the relay's own docs call it the
operator secret). It is one secret for the whole relay, so it is kept
somewhere safe that the people who share can reach — usually your team's
password manager; *Where do I get this?* under the **Team secret** field says
where, on a team build. The app asks for it the first time you share a
folder on a device and remembers it there. It checks it as you type, so a
mistyped secret tells you so straight away.

Opening a link needs no secret at all. Only people who create links need it.

Never paste the secret into a chat or a note. If it leaks, the person who
runs the relay changes it and everyone who shares enters the new one.

## One relay per group

Every share lives on one relay, and everyone in it must be able to reach that
relay. The simplest arrangement is **one relay per group** of people who work
together, run by one person in that group.

You can hold folders from more than one relay in the same vault: each folder
remembers which relay it came from. You create new links on one relay at a
time, the one set in **Settings › Sync & devices**. A team build of the app may be
locked to the team's own relay; then it says so, and it cannot reach any
other.

If you are not part of a team that runs one, you can run your own: see
[Running your own relay](relay.md). Anyone you share with must be able to
reach it.

## What the relay holds

The relay holds a copy of every shared folder's content, so it can hand it
to devices that join later. **That copy is not encrypted on the relay**: the
person who runs it can read every shared folder. Share with a relay run by
someone you trust with that folder.

It never holds the rest of your vault, only folders you have shared and,
if you link your own devices, the vault you linked. Losing the relay loses no
notes: every device keeps a full copy and the files are on disk. It costs the
links, which the person who runs it may have to make again.

## Your own devices

*Settings › Sync & devices › Link a device…* makes a device link. It opens your whole
vault, and every folder in it, now and later. Use it only between your own
computers, and never send it to anyone.
