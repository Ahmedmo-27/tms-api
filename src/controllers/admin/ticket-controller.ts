import { Request, Response } from "express";
import asyncHandler from "../../utils/asyncHandler";
import Ticket, { TICKET_STATUSES } from "../../models/ticket";
import TicketCategory from "../../models/ticketCategory";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError, NotFoundError } from "../../core/ApiError";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { sendTicketConfirmationEmail } from "../../services/email-service";
import logger from "../../config/logger";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const asTrimmed = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ──────────────────────────── PUBLIC (mobile app) ──────────────────────────── */

// Categories shown in the app's dropdown. Active only.
export const getActiveTicketCategories = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const categories = await TicketCategory.find({ isActive: true })
      .select("name")
      .sort({ name: 1 });
    new SuccessResponse("Ticket categories fetched", categories).send(res);
  }
);

// Submit a support ticket. No authentication required.
export const submitTicket = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const name = asTrimmed(req.body?.name);
    const phone = asTrimmed(req.body?.phone);
    const email = asTrimmed(req.body?.email).toLowerCase();
    const category = asTrimmed(req.body?.category);
    const otherDetails = asTrimmed(req.body?.otherDetails);
    const description = asTrimmed(req.body?.description);
    const isOther = category.toLowerCase() === "other";

    if (!name) throw new BadRequestError("VALIDATION", "Name is required");
    if (!phone) throw new BadRequestError("VALIDATION", "Phone number is required");
    if (!email || !EMAIL_REGEX.test(email))
      throw new BadRequestError("VALIDATION", "A valid email is required");
    if (!category)
      throw new BadRequestError("VALIDATION", "Please choose a problem category");
    if (isOther && !otherDetails)
      throw new BadRequestError(
        "VALIDATION",
        "Please describe your problem in the 'Other' field"
      );
    if (!description)
      throw new BadRequestError("VALIDATION", "Description is required");

    const ticket = await Ticket.create({
      name,
      phone,
      email,
      category,
      otherDetails: isOther ? otherDetails : undefined,
      description,
    });

    // Best-effort confirmation email; never blocks or fails the submission.
    void sendTicketConfirmationEmail(email, name, category).catch((e) =>
      logger.error("Ticket confirmation email failed", {
        error: (e as Error).message,
      })
    );

    new SuccessResponse(
      "Your request has been submitted. We'll get back to you soon.",
      { id: ticket._id, status: ticket.status }
    ).send(res);
  }
);

/* ───────────────────────────── ADMIN: tickets ───────────────────────────── */

// List tickets with optional status filter, text search and pagination.
export const getTickets = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { status, search, page, limit } = req.query;
    const query: Record<string, unknown> = {};

    if (status && (TICKET_STATUSES as readonly string[]).includes(status as string)) {
      query.status = status;
    }
    if (search) {
      const rx = { $regex: search as string, $options: "i" };
      query.$or = [
        { name: rx },
        { phone: rx },
        { email: rx },
        { category: rx },
      ];
    }

    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 20;
    const skip = (pageNum - 1) * limitNum;

    const total = await Ticket.countDocuments(query);
    const tickets = await Ticket.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    new SuccessResponse("Tickets fetched", {
      tickets,
      total,
      page: pageNum,
      limit: limitNum,
    }).send(res);
  }
);

// Update a ticket's status (resolve / reject / in_progress) and optional notes.
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

    const update: Record<string, unknown> = {
      status,
      handledBy: (req as AuthRequest).user?._id,
    };
    if (typeof adminNotes === "string") update.adminNotes = adminNotes.trim();

    const ticket = await Ticket.findByIdAndUpdate(id, update, { new: true });
    if (!ticket) throw new NotFoundError("TICKET_NOT_FOUND", "Ticket not found", { id });

    new SuccessResponse("Ticket updated", ticket).send(res);
  }
);

/* ──────────────────────────── ADMIN: categories ──────────────────────────── */

// All categories (including inactive) for the dashboard.
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
