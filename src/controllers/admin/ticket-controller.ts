import { Request, Response } from "express";
import { Types } from "mongoose";
import asyncHandler from "../../utils/asyncHandler";
import Ticket, { TICKET_STATUSES } from "../../models/ticket";
import TicketCategory from "../../models/ticketCategory";
import { SuccessResponse } from "../../core/ApiResponse";
import {
  BadRequestError,
  NotFoundError,
  AuthFailureError,
} from "../../core/ApiError";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { CoachAuthRequest } from "../../middlewares/coach.middleware";
import User from "../../models/user";
import { sendTicketConfirmationEmail } from "../../services/email-service";
import logger from "../../config/logger";

const asTrimmed = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalizeCreatorRole(role: string | undefined): string {
  if (!role || role === "user") return "member";
  if (role === "admin") return "management";
  return role;
}

interface TicketBody {
  category: string;
  otherDetails?: string;
  description: string;
}

function parseTicketBody(body: Record<string, unknown>): TicketBody {
  const category = asTrimmed(body?.category);
  const otherDetails = asTrimmed(body?.otherDetails);
  const description = asTrimmed(body?.description);
  const isOther = category.toLowerCase() === "other";

  if (!category)
    throw new BadRequestError("VALIDATION", "Please choose a problem category");
  if (isOther && !otherDetails)
    throw new BadRequestError(
      "VALIDATION",
      "Please describe your problem in the 'Other' field"
    );
  if (!description)
    throw new BadRequestError("VALIDATION", "Description is required");

  return {
    category,
    otherDetails: isOther ? otherDetails : undefined,
    description,
  };
}

async function createTicketForUser(userId: Types.ObjectId, body: TicketBody) {
  const userDoc = await User.findById(userId);
  if (!userDoc) throw new NotFoundError("USER_NOT_FOUND", "User not found in database");

  const isOther = body.category.toLowerCase() === "other";

  const ticket = await Ticket.create({
    name: userDoc.name,
    phone: userDoc.phoneNumber,
    email: userDoc.email,
    category: body.category,
    otherDetails: isOther ? body.otherDetails : undefined,
    description: body.description,
    locationId: (userDoc as { locationId?: Types.ObjectId }).locationId,
    createdBy: userDoc._id,
    creatorRole: normalizeCreatorRole(userDoc.role),
    creatorName: userDoc.name,
  });

  void sendTicketConfirmationEmail(userDoc.email, userDoc.name, body.category).catch((e) =>
    logger.error("Ticket confirmation email failed", {
      error: (e as Error).message,
    })
  );

  return ticket;
}

async function fetchTickets(queryParams: {
  status?: string;
  search?: string;
  page?: string;
  limit?: string;
}) {
  const { status, search, page, limit } = queryParams;
  const query: Record<string, unknown> = {};

  if (status && (TICKET_STATUSES as readonly string[]).includes(status)) {
    query.status = status;
  }
  if (search) {
    const rx = { $regex: search, $options: "i" };
    query.$or = [
      { name: rx },
      { phone: rx },
      { email: rx },
      { category: rx },
      { creatorName: rx },
    ];
  }

  const pageNum = parseInt(page ?? "") || 1;
  const limitNum = parseInt(limit ?? "") || 20;
  const skip = (pageNum - 1) * limitNum;

  const total = await Ticket.countDocuments(query);
  const tickets = await Ticket.find(query)
    .populate("locationId", "branchName location")
    .populate("createdBy", "name role")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum);

  return { tickets, total, page: pageNum, limit: limitNum };
}

interface HandlerMetadata {
  userId: Types.ObjectId;
  name: string;
  role: string;
}

async function getHandlerMetadata(userId: Types.ObjectId): Promise<HandlerMetadata> {
  const userDoc = await User.findById(userId).select("name role");
  if (!userDoc) {
    return { userId, name: "Unknown", role: "unknown" };
  }
  return {
    userId: userDoc._id as Types.ObjectId,
    name: userDoc.name,
    role: normalizeCreatorRole(userDoc.role),
  };
}

async function applyTicketUpdate(
  existing: {
    status: string;
    adminNotes?: string;
  },
  userId: Types.ObjectId,
  status: string,
  adminNotes?: unknown
) {
  const handler = await getHandlerMetadata(userId);
  const update: Record<string, unknown> = {
    status,
    handledBy: handler.userId,
    handledByName: handler.name,
    handledByRole: handler.role,
  };

  if (status !== existing.status) {
    update.statusUpdatedBy = handler.userId;
    update.statusUpdatedByName = handler.name;
    update.statusUpdatedByRole = handler.role;
    update.statusUpdatedAt = new Date();
  }

  if (typeof adminNotes === "string") {
    const trimmedNotes = adminNotes.trim();
    update.adminNotes = trimmedNotes;
    if (trimmedNotes !== (existing.adminNotes ?? "").trim()) {
      update.notesUpdatedBy = handler.userId;
      update.notesUpdatedByName = handler.name;
      update.notesUpdatedByRole = handler.role;
      update.notesUpdatedAt = new Date();
    }
  }

  return update;
}

/* ──────────────────────────── PUBLIC (mobile app) ──────────────────────────── */

export const getActiveTicketCategories = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const categories = await TicketCategory.find({ isActive: true })
      .select("name")
      .sort({ name: 1 });
    new SuccessResponse("Ticket categories fetched", categories).send(res);
  }
);

export const submitTicket = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const userId = authReq.user?._id;
    if (!userId) throw new AuthFailureError("UNAUTHORIZED", "Not authorized to submit ticket");

    const body = parseTicketBody(req.body ?? {});
    const ticket = await createTicketForUser(userId as Types.ObjectId, body);

    new SuccessResponse(
      "Your request has been submitted. We'll get back to you soon.",
      { id: ticket._id, status: ticket.status }
    ).send(res);
  }
);

/* ───────────────────────────── ADMIN: tickets ───────────────────────────── */

export const getTickets = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const result = await fetchTickets({
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      page: req.query.page as string | undefined,
      limit: req.query.limit as string | undefined,
    });
    new SuccessResponse("Tickets fetched", result).send(res);
  }
);

export const updateTicketStatus = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const status = req.body?.status;
    const adminNotes = req.body?.adminNotes;

    if (!status || !(TICKET_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestError(
        "VALIDATION",
        `Status must be one of: ${TICKET_STATUSES.join(", ")}`
      );
    }

    const existing = await Ticket.findById(id);
    if (!existing) throw new NotFoundError("TICKET_NOT_FOUND", "Ticket not found", { id });

    const authReq = req as AuthRequest;
    const userId = authReq.user?._id as Types.ObjectId;
    const update = await applyTicketUpdate(existing, userId, status, adminNotes);

    const ticket = await Ticket.findByIdAndUpdate(id, update, { new: true });
    if (!ticket) throw new NotFoundError("TICKET_NOT_FOUND", "Ticket not found", { id });

    new SuccessResponse("Ticket updated", ticket).send(res);
  }
);

/* ───────────────────────────── COACH: tickets ───────────────────────────── */

export const getCoachTickets = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const result = await fetchTickets({
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      page: req.query.page as string | undefined,
      limit: req.query.limit as string | undefined,
    });
    new SuccessResponse("Tickets fetched", result).send(res);
  }
);

export const submitCoachTicket = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const coachReq = req as CoachAuthRequest;
    const body = parseTicketBody(req.body ?? {});
    const ticket = await createTicketForUser(coachReq.coachId, body);

    new SuccessResponse(
      "Your request has been submitted. We'll get back to you soon.",
      { id: ticket._id, status: ticket.status }
    ).send(res);
  }
);

export const updateCoachTicketStatus = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const coachReq = req as CoachAuthRequest;
    const { id } = req.params;
    const status = req.body?.status;
    const adminNotes = req.body?.adminNotes;

    if (!status || !(TICKET_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestError(
        "VALIDATION",
        `Status must be one of: ${TICKET_STATUSES.join(", ")}`
      );
    }

    const existing = await Ticket.findById(id);
    if (!existing) throw new NotFoundError("TICKET_NOT_FOUND", "Ticket not found", { id });

    const update = await applyTicketUpdate(
      existing,
      coachReq.coachId,
      status,
      adminNotes
    );

    const ticket = await Ticket.findByIdAndUpdate(id, update, { new: true });
    if (!ticket) throw new NotFoundError("TICKET_NOT_FOUND", "Ticket not found", { id });

    new SuccessResponse("Ticket updated", ticket).send(res);
  }
);

/* ──────────────────────────── ADMIN: categories ──────────────────────────── */

export const getTicketCategories = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const categories = await TicketCategory.find().sort({ name: 1 });
    new SuccessResponse("Categories fetched", categories).send(res);
  }
);

export const addTicketCategory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const name = asTrimmed(req.body?.name);
    if (!name) throw new BadRequestError("VALIDATION", "Category name is required");

    const existing = await TicketCategory.findOne({
      name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
    });
    if (existing)
      throw new BadRequestError("DUPLICATE", "A category with this name already exists");

    const category = await TicketCategory.create({ name });
    new SuccessResponse("Category added", category).send(res);
  }
);

export const updateTicketCategory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const update: Record<string, unknown> = {};

    if (typeof req.body?.name === "string") {
      const name = req.body.name.trim();
      if (!name) throw new BadRequestError("VALIDATION", "Category name cannot be empty");
      update.name = name;
    }
    if (typeof req.body?.isActive === "boolean") update.isActive = req.body.isActive;

    const category = await TicketCategory.findByIdAndUpdate(id, update, { new: true });
    if (!category)
      throw new NotFoundError("CATEGORY_NOT_FOUND", "Category not found", { id });

    new SuccessResponse("Category updated", category).send(res);
  }
);

export const deleteTicketCategory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const category = await TicketCategory.findByIdAndDelete(id);
    if (!category)
      throw new NotFoundError("CATEGORY_NOT_FOUND", "Category not found", { id });
    new SuccessResponse("Category deleted", category).send(res);
  }
);
